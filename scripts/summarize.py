"""调用 Qwen 生成摘要 + Kimi 评分，把 raw.json 变成 report.json"""
import json
import os
import sys
import time

import requests

BASE = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(BASE, "data", "raw.json")
OUT_DIR = os.path.join(BASE, "data", "reports")

# Kimi 配置（仅用于 importance 评分）
KIMI_API_KEY = os.environ.get("MOONSHOT_API_KEY", "").strip()
KIMI_MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.6")
KIMI_API_URL = "https://api.moonshot.cn/v1/chat/completions"

# Qwen 配置（用于摘要生成）
QWEN_API_KEY = os.environ.get("QWEN_API_KEY", "").strip()
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen-plus")
QWEN_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

# Token 计数
_token_log = {"kimi_prompt": 0, "kimi_completion": 0, "qwen_prompt": 0, "qwen_completion": 0}

# Qwen 摘要生成提示词（不含 importance，由 Kimi 单独评分）
QWEN_SUMMARY_PROMPT = """你是一位资深的 AI 与开源技术分析师，服务对象是一位【完全不懂编程】的用户。

【用户背景】
- 行业：中国智慧交通（含智慧高速）、智慧消防
- 当前项目：高速公路和轨道业务板块的施工成本管控系统
- 身份：业务/管理人员，非技术人员

【任务】
对输入的每一条资讯/项目，输出严格 JSON（数组，每个元素对应一条），字段如下：
{
  "title": "原标题（保持原样）",
  "url": "原链接（保持原样）",
  "source": "来源（保持原样）",
  "brief": "一句话概述这是什么，不超过 40 字，大白话",
  "what": "这是什么？1-2 句大白话，禁止堆砌术语",
  "industry_use": "对用户的行业（智慧交通/智慧高速/智慧消防/施工成本管控）有什么用？1-2 句。关联弱就直说，禁止硬扯",
  "capability": "这能干什么？解决什么具体问题，1-2 句",
  "assessment": "评估和判断：成熟度、热度是否真实、是否值得关注，中立，1-2 句",
  "risk": "风险是什么？适合应用在哪里？1-2 句"
}

【要求】
- 只输出 JSON 数组本身，不要输出任何其他文字、不要用 markdown 代码块包裹
- 所有解读用简体中文，语气中立，不吹不黑
- 评估要有依据，不确定就说不确定"""

# Kimi importance 评分提示词（轻量，只输出分数）
KIMI_SCORE_PROMPT = """你是一位资深的 AI 与开源技术分析师。
【用户背景】行业：中国智慧交通（含智慧高速）、智慧消防、施工成本管控。身份：业务/管理人员，非技术人员。

【任务】
对以下每条资讯，只输出一个 JSON 数组，每个元素只有两个字段：
{"title": "条目标题（保持原样）", "importance": 1到5的整数}

importance 评分标准：
5 = 与用户行业直接相关，强烈建议关注
4 = 与用户行业有较强关联，值得关注
3 = 与用户行业有一定关联，可以留意
2 = 与用户行业关联较弱，但技术趋势值得了解
1 = 与用户行业基本无关

【要求】
- 只输出 JSON 数组，不要其他文字，不要 markdown 代码块
- 必须为每条资讯给出评分，不要遗漏"""

SYNTHESIS_PROMPT = """你是一位资深的 AI 与开源技术分析师，服务对象是一位【完全不懂编程】的用户。

【用户背景】
- 行业：中国智慧交通（含智慧高速）、智慧消防
- 当前项目：高速公路和轨道业务板块的施工成本管控系统
- 身份：业务/管理人员，非技术人员

【任务】
以下是今天（{date}）科技雷达抓到的 {count} 条资讯清单（标题+简述）。
请输出"今日总结"，严格 JSON（不要 markdown 代码块，不要任何其他文字）：
{{
  "overview": "今日总览：3-4 句大白话概括今天 AI/开源圈的整体态势",
  "conclusions": ["结论1", "结论2", "结论3"],
  "top_picks": [{{"title": "今日最值得关注的条目标题", "reason": "为什么，1 句"}}],
  "industry_use": "今日内容对用户行业的整体启示：哪些动向值得智慧交通/智慧高速/智慧消防/施工成本管控领域留意，2-3 句。无直接关联就直说",
  "risks": "今日信息中需要警惕的风险（夸大宣传/合规/落地难度等），2 句"
}}

【要求】
- conclusions 给 3-5 条，每条是一个有判断、有态度的结论句，不是资讯复述
- top_picks 最多 3 条，title 必须与输入清单一字不差
- 全部用简体中文，中立，不吹不黑"""


def _post_json(api_url, api_key, payload, label="api"):
    """通用 API 调用，带 token 计数"""
    for attempt in range(3):
        try:
            r = requests.post(api_url, json=payload, timeout=300,
                              headers={"Authorization": f"Bearer {api_key}"})
            r.raise_for_status()
            data = r.json()
            usage = data.get("usage", {})
            # Token 计数
            if "kimi" in label:
                _token_log["kimi_prompt"] += usage.get("prompt_tokens", 0)
                _token_log["kimi_completion"] += usage.get("completion_tokens", 0)
            else:
                _token_log["qwen_prompt"] += usage.get("prompt_tokens", 0)
                _token_log["qwen_completion"] += usage.get("completion_tokens", 0)
            content = data["choices"][0]["message"]["content"].strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0]
            return json.loads(content)
        except Exception as e:
            print(f"{label} attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                time.sleep(10)
    return None


def call_qwen_summary(items, retries=2):
    """Qwen 生成摘要字段（不含 importance）"""
    payload = {
        "model": QWEN_MODEL,
        "messages": [
            {"role": "system", "content": QWEN_SUMMARY_PROMPT},
            {"role": "user", "content": "请解读以下资讯：\n" + json.dumps(items, ensure_ascii=False)},
        ],
    }
    return _post_json(QWEN_API_URL, QWEN_API_KEY, payload, label="qwen")


def call_kimi_score(items, retries=2):
    """Kimi 只做 importance 评分"""
    payload = {
        "model": KIMI_MODEL,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": KIMI_SCORE_PROMPT},
            {"role": "user", "content": "请评分以下资讯：\n" + json.dumps(items, ensure_ascii=False)},
        ],
    }
    return _post_json(KIMI_API_URL, KIMI_API_KEY, payload, label="kimi")


def call_kimi_synthesis(items, date_str, retries=2):
    """Kimi 生成今日总结（日报合成）"""
    payload = {
        "model": KIMI_MODEL,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "user", "content":
                SYNTHESIS_PROMPT.format(date=date_str, count=len(items))
                + "\n\n【今日资讯清单】\n" + json.dumps(items, ensure_ascii=False)},
        ],
    }
    return _post_json(KIMI_API_URL, KIMI_API_KEY, payload, label="kimi")


# 旧 SYSTEM_PROMPT 用于 Kimi 全量解读 fallback（无 Qwen 时）
_KIMI_FULL_PROMPT = """你是一位资深的 AI 与开源技术分析师，服务对象是一位【完全不懂编程】的用户。

【用户背景】
- 行业：中国智慧交通（含智慧高速）、智慧消防
- 当前项目：高速公路和轨道业务板块的施工成本管控系统
- 身份：业务/管理人员，非技术人员

【任务】
对输入的每一条资讯/项目，输出严格 JSON（数组，每个元素对应一条），字段如下：
{
  "title": "原标题（保持原样）",
  "url": "原链接（保持原样）",
  "source": "来源（保持原样）",
  "brief": "一句话概述这是什么，不超过 40 字，大白话",
  "what": "这是什么？1-2 句大白话，禁止堆砌术语",
  "industry_use": "对用户的行业（智慧交通/智慧高速/智慧消防/施工成本管控）有什么用？1-2 句。关联弱就直说，禁止硬扯",
  "capability": "这能干什么？解决什么具体问题，1-2 句",
  "assessment": "评估和判断：成熟度、热度是否真实、是否值得关注，中立，1-2 句",
  "risk": "风险是什么？适合应用在哪里？1-2 句",
  "importance": 1到5的整数，表示对用户背景的推荐关注度（5=强烈建议关注）
}

【要求】
- 只输出 JSON 数组本身，不要输出任何其他文字、不要用 markdown 代码块包裹
- 所有解读用简体中文，语气中立，不吹不黑
- 评估要有依据，不确定就说不确定"""


def _call_kimi_full(items, retries=2):
    """Kimi 全量解读（仅 fallback，无 Qwen 时使用）"""
    payload = {
        "model": KIMI_MODEL,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": _KIMI_FULL_PROMPT},
            {"role": "user", "content": "请解读以下资讯：\n" + json.dumps(items, ensure_ascii=False)},
        ],
    }
    return _post_json(KIMI_API_URL, KIMI_API_KEY, payload, label="kimi")


def main():
    has_qwen = bool(QWEN_API_KEY)
    has_kimi = bool(KIMI_API_KEY)

    if not has_qwen and not has_kimi:
        print("未设置 QWEN_API_KEY 和 MOONSHOT_API_KEY，跳过 AI 解读，生成纯榜单报告")
        analyzed = None
        summary = None
    else:
        raw = json.load(open(RAW, encoding="utf-8"))
        items = [{"title": i["title"], "url": i["url"], "source": i["source"],
                  "description": i.get("description", ""), "extra": i.get("extra", "")}
                 for i in raw["items"]]

        analyzed = None

        if has_qwen:
            # Step 1: Qwen 生成摘要字段（不含 importance）
            print("Step 1: Qwen 生成摘要...")
            chunk = 18
            qwen_results = []
            for i in range(0, len(items), chunk):
                part = call_qwen_summary(items[i:i + chunk])
                if part:
                    qwen_results.extend(part)
                else:
                    print(f"  第 {i // chunk + 1} 批 Qwen 摘要失败")
            if qwen_results:
                print(f"  Qwen 完成 {len(qwen_results)} 条摘要")
            analyzed = qwen_results if qwen_results else None

        if has_kimi and analyzed:
            # Step 2: Kimi 只给 importance 评分
            print("Step 2: Kimi 评分 importance...")
            score_items = [{"title": a["title"], "url": a.get("url", ""),
                            "source": a.get("source", ""),
                            "brief": a.get("brief", ""),
                            "what": a.get("what", "")}
                           for a in analyzed]
            scores = call_kimi_score(score_items)
            if scores:
                score_map = {s["title"]: s.get("importance", 3) for s in scores}
                for a in analyzed:
                    a["importance"] = score_map.get(a["title"], 3)
                print(f"  Kimi 完成 {len(scores)} 条评分")
            else:
                print("  Kimi 评分失败，使用默认 importance=3")
                for a in analyzed:
                    a.setdefault("importance", 3)
        elif has_kimi and not analyzed:
            # 无 Qwen 时，Kimi 做全量解读（兼容旧逻辑）
            print("Step 1 (fallback): Kimi 全量解读...")
            chunk = 18
            kimi_results = []
            for i in range(0, len(items), chunk):
                part = _call_kimi_full(items[i:i + chunk])
                if part:
                    kimi_results.extend(part)
                else:
                    print(f"  第 {i // chunk + 1} 批 Kimi 全量解读失败")
            analyzed = kimi_results if kimi_results else None

        # Token 日志
        total = _token_log["kimi_prompt"] + _token_log["kimi_completion"] + \
                _token_log["qwen_prompt"] + _token_log["qwen_completion"]
        print(f"Token 统计: Kimi(in={_token_log['kimi_prompt']},out={_token_log['kimi_completion']}) "
              f"Qwen(in={_token_log['qwen_prompt']},out={_token_log['qwen_completion']}) "
              f"总计={total}")

        if analyzed:
            brief_items = [{"title": a.get("title"), "source": a.get("source"),
                            "brief": a.get("brief", ""), "importance": a.get("importance", 3)}
                           for a in analyzed]
            summary = call_kimi_synthesis(brief_items, raw["fetched_at"][:10])
        else:
            summary = None

    raw = json.load(open(RAW, encoding="utf-8"))
    date_str = raw["fetched_at"][:10]
    os.makedirs(OUT_DIR, exist_ok=True)

    # pipeline 版本标记：用于 Phase 3 就绪度检测区分不同评分架构的数据
    if has_qwen and analyzed:
        pipeline_ver = "split"      # 方案C: Qwen摘要 + Kimi评分
    elif has_kimi and analyzed:
        pipeline_ver = "kimi_full"  # 旧架构: Kimi 全量解读
    else:
        pipeline_ver = "none"       # 无 AI

    if analyzed:
        extra_map = {i["title"]: i for i in raw["items"]}
        for a in analyzed:
            src = extra_map.get(a.get("title"), {})
            a.setdefault("extra", src.get("extra", ""))
        report = {"date": date_str, "fetched_at": raw["fetched_at"],
                  "ai_enabled": True, "pipeline": pipeline_ver,
                  "summary": summary, "items": analyzed}
    else:
        report = {"date": date_str, "fetched_at": raw["fetched_at"],
                  "ai_enabled": False, "pipeline": pipeline_ver,
                  "summary": summary, "items": raw["items"]}

    path = os.path.join(OUT_DIR, f"{date_str}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"OK -> {path} ({len(report['items'])} 条, AI解读={'是' if analyzed else '否'})")


if __name__ == "__main__":
    main()

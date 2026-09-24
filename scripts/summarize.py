"""调用 Kimi API，把 raw.json 变成按固定格式解读的 report.json"""
import json
import os
import sys
import time

import requests

BASE = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(BASE, "data", "raw.json")
OUT_DIR = os.path.join(BASE, "data", "reports")

API_KEY = os.environ.get("MOONSHOT_API_KEY", "").strip()
MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.6")
API_URL = "https://api.moonshot.cn/v1/chat/completions"

SYSTEM_PROMPT = """你是一位资深的 AI 与开源技术分析师，服务对象是一位【完全不懂编程】的用户。

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


def call_kimi(items, retries=2):
    payload = {
        "model": MODEL,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "请解读以下资讯：\n" + json.dumps(items, ensure_ascii=False)},
        ],
    }
    return _post(payload, retries)


def call_kimi_synthesis(items, date_str, retries=2):
    payload = {
        "model": MODEL,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "user", "content":
                SYNTHESIS_PROMPT.format(date=date_str, count=len(items))
                + "\n\n【今日资讯清单】\n" + json.dumps(items, ensure_ascii=False)},
        ],
    }
    return _post(payload, retries)


def _post(payload, retries):
    for attempt in range(retries + 1):
        try:
            r = requests.post(API_URL, json=payload, timeout=300,
                              headers={"Authorization": f"Bearer {API_KEY}"})
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"].strip()
            # 容错：剥掉可能的 markdown 代码块
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0]
            return json.loads(content)
        except Exception as e:
            print(f"kimi attempt {attempt + 1} failed: {e}")
            if attempt < retries:
                time.sleep(10)
    return None


def main():
    if not API_KEY:
        print("未设置 MOONSHOT_API_KEY，跳过 AI 解读，生成纯榜单报告")
        analyzed = None
        summary = None
    else:
        raw = json.load(open(RAW, encoding="utf-8"))
        items = [{"title": i["title"], "url": i["url"], "source": i["source"],
                  "description": i.get("description", ""), "extra": i.get("extra", "")}
                 for i in raw["items"]]
        analyzed = []
        chunk = 18
        for i in range(0, len(items), chunk):
            part = call_kimi(items[i:i + chunk])
            if part:
                analyzed.extend(part)
            else:
                print(f"第 {i // chunk + 1} 批解读失败，该批按未解读处理")
        if not analyzed:
            analyzed = None
        brief_items = [{"title": a.get("title"), "source": a.get("source"),
                        "brief": a.get("brief", ""), "importance": a.get("importance", 3)}
                       for a in analyzed] if analyzed else items
        summary = call_kimi_synthesis(brief_items, raw["fetched_at"][:10])

    raw = json.load(open(RAW, encoding="utf-8"))
    date_str = raw["fetched_at"][:10]
    os.makedirs(OUT_DIR, exist_ok=True)

    if analyzed:
        # 把抓取时的补充信息合并回解读结果
        extra_map = {i["title"]: i for i in raw["items"]}
        for a in analyzed:
            src = extra_map.get(a.get("title"), {})
            a.setdefault("extra", src.get("extra", ""))
        report = {"date": date_str, "fetched_at": raw["fetched_at"],
                  "ai_enabled": True, "summary": summary, "items": analyzed}
    else:
        report = {"date": date_str, "fetched_at": raw["fetched_at"],
                  "ai_enabled": False, "summary": summary, "items": raw["items"]}

    path = os.path.join(OUT_DIR, f"{date_str}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"OK -> {path} ({len(report['items'])} 条, AI解读={'是' if analyzed else '否'})")


if __name__ == "__main__":
    main()

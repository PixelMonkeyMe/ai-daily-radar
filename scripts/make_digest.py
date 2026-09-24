"""按时间区间聚合日报，生成周报/月报/季报/自定义汇总（含 Kimi 趋势分析）
用法:
  python scripts/make_digest.py --type weekly
  python scripts/make_digest.py --type monthly
  python scripts/make_digest.py --type quarterly
  python scripts/make_digest.py --type custom --start 2026-09-01 --end 2026-09-21
"""
import argparse
import glob
import json
import os
import re
import time
from datetime import datetime, timedelta

import requests

BASE = os.path.join(os.path.dirname(__file__), "..")
REPORTS_DIR = os.path.join(BASE, "data", "reports")
OUT_DIR = os.path.join(BASE, "data", "digests")

API_KEY = os.environ.get("MOONSHOT_API_KEY", "").strip()
MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.6")
API_URL = "https://api.moonshot.cn/v1/chat/completions"

DIGEST_PROMPT = """你是一位资深的 AI 与开源技术分析师，服务对象是一位【完全不懂编程】的用户。

【用户背景】
- 行业：中国智慧交通（含智慧高速）、智慧消防
- 当前项目：高速公路和轨道业务板块的施工成本管控系统
- 身份：业务/管理人员，非技术人员

【任务】
输入是某个时间区间（{start} 至 {end}，共 {days} 天）内每日科技雷达抓到的 {count} 条资讯的标题清单。
请站在"回头看"的高度做周期复盘，输出严格 JSON（不要 markdown 代码块，不要任何其他文字）：
{{
  "overview": "本期总览：这个区间 AI/开源领域的整体态势，3-4 句大白话",
  "trends": ["趋势1", "趋势2", "趋势3"],
  "top_picks": [{{"title": "最值得关注的条目原标题", "reason": "为什么值得这位用户关注，1-2 句"}}],
  "industry_use": "本期内容对用户所在行业（智慧交通/智慧高速/智慧消防/施工成本管控）的整体启示：哪些动向值得行业留意、可落地在哪些环节。无直接关联的部分诚实说明，禁止硬扯",
  "risks": "本期需要注意的风险：夸大宣传/合规/落地难度等，中立客观，2-3 句",
  "outlook": "下个周期值得盯住的观察点，2-3 句"
}}

【要求】
- trends 给 3-5 条，每条一句话点明趋势并举例（用清单里的真实条目标题）
- top_picks 最多 5 条，必须从输入清单中选取，title 与原文一字不差
- 全部用简体中文，中立，不吹不黑"""


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--type", required=True, choices=["weekly", "monthly", "quarterly", "custom"])
    p.add_argument("--start")
    p.add_argument("--end")
    return p.parse_args()


def default_range(dtype, today):
    if dtype == "weekly":
        return today - timedelta(days=6), today
    if dtype == "monthly":
        first = today.replace(day=1)
        end = first - timedelta(days=1)
        return end.replace(day=1), end
    if dtype == "quarterly":
        q_first_month = 3 * ((today.month - 1) // 3) + 1
        end = today.replace(month=q_first_month, day=1) - timedelta(days=1)
        return end.replace(day=1, month=3 * ((end.month - 1) // 3) + 1), end
    raise ValueError(dtype)


def make_label(dtype, start, end):
    if dtype == "weekly":
        iso = end.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    if dtype == "monthly":
        return start.strftime("%Y-%m")
    if dtype == "quarterly":
        return f"{start.year}-Q{(start.month - 1) // 3 + 1}"
    return f"{start:%Y-%m-%d}_to_{end:%Y-%m-%d}"


TYPE_CN = {"weekly": "周报", "monthly": "月报", "quarterly": "季报", "custom": "自定义汇总"}


def collect(start, end):
    items, seen = [], set()
    days = 0
    for f in sorted(glob.glob(os.path.join(REPORTS_DIR, "*.json"))):
        m = re.match(r"(\d{4}-\d{2}-\d{2})\.json$", os.path.basename(f))
        if not m:
            continue
        d = datetime.strptime(m.group(1), "%Y-%m-%d").date()
        if not (start <= d <= end):
            continue
        days += 1
        rep = json.load(open(f, encoding="utf-8"))
        for it in rep["items"]:
            key = it.get("url") or it.get("title")
            if key in seen:
                continue
            seen.add(key)
            it.setdefault("date", rep["date"])
            items.append(it)
    items.sort(key=lambda x: -(x.get("importance") or 0))
    return items, days


def call_kimi(prompt):
    for attempt in range(3):
        try:
            r = requests.post(API_URL, timeout=300,
                              headers={"Authorization": f"Bearer {API_KEY}"},
                              json={"model": MODEL,
                                    "thinking": {"type": "disabled"},
                                    "messages": [{"role": "user", "content": prompt}]})
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"].strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0]
            return json.loads(content)
        except Exception as e:
            print(f"kimi attempt {attempt + 1} failed: {e}")
            time.sleep(10)
    return None


def main():
    args = parse_args()
    today = datetime.now().date()
    if args.type == "custom":
        start = datetime.strptime(args.start, "%Y-%m-%d").date()
        end = datetime.strptime(args.end, "%Y-%m-%d").date()
    else:
        start, end = default_range(args.type, today)
    label = make_label(args.type, start, end)

    items, days = collect(start, end)
    print(f"{TYPE_CN[args.type]} {label}: {start} ~ {end}, {days} 期日报, {len(items)} 条资讯")
    if not items:
        print("区间内没有数据，跳过")
        return

    source_stats = {}
    for it in items:
        source_stats[it["source"]] = source_stats.get(it["source"], 0) + 1

    analysis = None
    if API_KEY:
        brief = [{"title": i["title"], "source": i["source"],
                  "importance": i.get("importance", 3)} for i in items[:80]]
        prompt = (DIGEST_PROMPT.format(start=start, end=end, days=days, count=len(items))
                  + "\n\n【资讯清单】\n" + json.dumps(brief, ensure_ascii=False))
        analysis = call_kimi(prompt)
    else:
        print("未设置 MOONSHOT_API_KEY，生成无 AI 分析的统计版汇总")

    digest = {"label": label, "type": args.type, "type_cn": TYPE_CN[args.type],
              "start": str(start), "end": str(end),
              "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
              "report_days": days, "item_count": len(items),
              "source_stats": source_stats,
              "ai_enabled": bool(analysis), "analysis": analysis,
              "items": items}
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{label}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(digest, f, ensure_ascii=False, indent=2)
    print(f"OK -> {path}")


if __name__ == "__main__":
    main()

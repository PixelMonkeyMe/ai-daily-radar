#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 3 就绪度检测：分析近期 report 数据，判断是否可以推进双路评分

只统计 pipeline="split"（方案C: Qwen摘要 + Kimi评分）生成的报告。
旧 pipeline（kimi_full / none）的数据结构虽相同，但评分逻辑不同，
混入统计会导致假阳性。
"""
import json, os, sys, glob
from datetime import datetime, timedelta

BASE = os.path.join(os.path.dirname(__file__), "..")
REPORTS_DIR = os.path.join(BASE, "data", "reports")
OUTPUT = os.path.join(BASE, "data", "phase3_readiness.json")

# 方案C pipeline 版本标识（在 summarize.py 中写入）
SPLIT_PIPELINE = "split"


def analyze_reports(days=10):
    """分析最近 N 天的报告（扩大扫描窗口，因为方案C 刚上线，有效数据可能稀疏）"""
    reports = sorted(glob.glob(os.path.join(REPORTS_DIR, "*.json")), reverse=True)[:days]

    if not reports:
        return {"ready": False, "reason": "没有报告数据", "days_analyzed": 0,
                "split_days": 0}

    results = []
    skipped = {"no_pipeline_field": 0, "old_pipeline": 0, "no_items": 0}

    for path in reports:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # --- 关键过滤：只统计方案C 数据 ---
        pipeline = data.get("pipeline", "")
        if not pipeline:
            skipped["no_pipeline_field"] += 1
            continue
        if pipeline != SPLIT_PIPELINE:
            skipped["old_pipeline"] += 1
            continue

        items = data.get("items", [])
        if not items:
            skipped["no_items"] += 1
            continue

        # 1. 字段完整率
        total = len(items)
        fields = ["brief", "what", "industry_use", "capability", "assessment", "risk"]
        missing = {f: sum(1 for i in items if not i.get(f)) for f in fields}
        complete_rate = 1 - sum(missing.values()) / (total * len(fields))

        # 2. importance 分布
        imp_vals = [i.get("importance", 0) for i in items]
        imp_dist = {v: imp_vals.count(v) for v in range(1, 6)}
        mid_range = imp_dist.get(2, 0) + imp_dist.get(3, 0) + imp_dist.get(4, 0)
        mid_rate = mid_range / total if total > 0 else 0

        # 3. 平均 importance
        avg_imp = sum(imp_vals) / total if total > 0 else 0

        results.append({
            "date": data.get("date", os.path.basename(path)[:10]),
            "pipeline": pipeline,
            "items": total,
            "complete_rate": round(complete_rate, 3),
            "importance_dist": imp_dist,
            "mid_range_rate": round(mid_rate, 3),
            "avg_importance": round(avg_imp, 2),
        })

    if not results:
        return {
            "ready": False,
            "reason": "方案C 数据不足",
            "days_analyzed": 0,
            "split_days": 0,
            "skipped": skipped,
            "total_reports_scanned": len(reports),
            "thresholds": {
                "complete_rate": 0.98,
                "mid_range_rate": 0.6,
                "min_days": 3,
            },
        }

    # 综合评估
    avg_complete = sum(r["complete_rate"] for r in results) / len(results)
    avg_mid_rate = sum(r["mid_range_rate"] for r in results) / len(results)

    # 就绪条件
    ready = (
        avg_complete >= 0.98 and
        avg_mid_rate >= 0.6 and
        len(results) >= 3  # 至少 3 天方案C 数据
    )

    return {
        "ready": ready,
        "days_analyzed": len(results),
        "split_days": len(results),
        "reports": results,
        "avg_complete_rate": round(avg_complete, 3),
        "avg_mid_range_rate": round(avg_mid_rate, 3),
        "skipped": skipped,
        "total_reports_scanned": len(reports),
        "thresholds": {
            "complete_rate": 0.98,
            "mid_range_rate": 0.6,
            "min_days": 3,
        },
        "checked_at": datetime.now().isoformat(),
    }

if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    result = analyze_reports(days)

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    scanned = result.get("total_reports_scanned", 0)
    split_d = result.get("split_days", 0)
    skipped = result.get("skipped", {})

    print(f"Phase 3 readiness check")
    print(f"  Scanned: {scanned} reports")
    print(f"  Valid (split pipeline): {split_d} days")
    if skipped.get("no_pipeline_field"):
        print(f"  Skipped (no pipeline field): {skipped['no_pipeline_field']}")
    if skipped.get("old_pipeline"):
        print(f"  Skipped (old pipeline): {skipped['old_pipeline']}")

    if split_d > 0:
        print(f"  Avg completeness: {result.get('avg_complete_rate', 0):.1%}")
        print(f"  Avg mid-range rate: {result.get('avg_mid_range_rate', 0):.1%}")

    ready_str = 'READY' if result['ready'] else 'NOT READY'
    print(f"  Status: {ready_str}")

    if not result['ready']:
        reasons = []
        cr = result.get('avg_complete_rate', 0)
        mr = result.get('avg_mid_range_rate', 0)
        th = result.get('thresholds', {})
        if split_d < th.get('min_days', 3):
            reasons.append(f"split data {split_d}d < {th['min_days']}d")
        if cr < th.get('complete_rate', 0.98):
            reasons.append(f"completeness {cr:.1%} < {th['complete_rate']:.0%}")
        if mr < th.get('mid_range_rate', 0.6):
            reasons.append(f"mid-range {mr:.1%} < {th['mid_range_rate']:.0%}")
        print(f"  Gap: {', '.join(reasons) if reasons else 'no split-pipeline data yet'}")
        remaining = max(0, th.get('min_days', 3) - split_d)
        if remaining > 0:
            print(f"  Need {remaining} more days of split-pipeline data")

    print(f"\nSaved: {OUTPUT}")

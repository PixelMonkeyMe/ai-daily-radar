#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 3 就绪度检测：分析近期 report 数据，判断是否可以推进双路评分"""
import json, os, sys, glob
from datetime import datetime, timedelta

BASE = os.path.join(os.path.dirname(__file__), "..")
REPORTS_DIR = os.path.join(BASE, "data", "reports")
OUTPUT = os.path.join(BASE, "data", "phase3_readiness.json")

def analyze_reports(days=5):
    """分析最近 N 天的报告"""
    # 获取最近的报告文件
    reports = sorted(glob.glob(os.path.join(REPORTS_DIR, "*.json")), reverse=True)[:days]
    
    if not reports:
        return {"ready": False, "reason": "没有报告数据", "days_analyzed": 0}
    
    results = []
    for path in reports:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        items = data.get("items", [])
        if not items:
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
            "items": total,
            "complete_rate": round(complete_rate, 3),
            "importance_dist": imp_dist,
            "mid_range_rate": round(mid_rate, 3),
            "avg_importance": round(avg_imp, 2),
        })
    
    if not results:
        return {"ready": False, "reason": "无有效报告", "days_analyzed": 0}
    
    # 综合评估
    avg_complete = sum(r["complete_rate"] for r in results) / len(results)
    avg_mid_rate = sum(r["mid_range_rate"] for r in results) / len(results)
    
    # 就绪条件
    ready = (
        avg_complete >= 0.98 and
        avg_mid_rate >= 0.6 and
        len(results) >= 3  # 至少 3 天数据
    )
    
    return {
        "ready": ready,
        "days_analyzed": len(results),
        "reports": results,
        "avg_complete_rate": round(avg_complete, 3),
        "avg_mid_range_rate": round(avg_mid_rate, 3),
        "thresholds": {
            "complete_rate": 0.98,
            "mid_range_rate": 0.6,
            "min_days": 3,
        },
        "checked_at": datetime.now().isoformat(),
    }

if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    result = analyze_reports(days)
    
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"Phase 3 readiness ({result['days_analyzed']} days)")
    print(f"  Avg completeness: {result.get('avg_complete_rate', 0):.1%}")
    print(f"  Avg mid-range rate: {result.get('avg_mid_range_rate', 0):.1%}")
    ready_str = 'READY' if result['ready'] else 'NOT READY'
    print(f'  Status: {ready_str}')
    if not result['ready']:
        reasons = []
        if result.get('avg_complete_rate', 0) < result['thresholds']['complete_rate']:
            reasons.append(f"completeness {result['avg_complete_rate']:.1%} < {result['thresholds']['complete_rate']:.0%}")
        if result.get('avg_mid_range_rate', 0) < result['thresholds']['mid_range_rate']:
            reasons.append(f"mid-range {result['avg_mid_range_rate']:.1%} < {result['thresholds']['mid_range_rate']:.0%}")
        if result['days_analyzed'] < result['thresholds']['min_days']:
            reasons.append(f"only {result['days_analyzed']} days < {result['thresholds']['min_days']}")
        print(f"  Gap: {', '.join(reasons)}")
        print(f"  原因: 需要连续 {result['thresholds']['min_days']} 天达标")
    
    print(f"\n报告已保存: {OUTPUT}")

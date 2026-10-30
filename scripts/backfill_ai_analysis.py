#!/usr/bin/env python3
"""
Phase 3.3c: 回填现有收藏的 AI 分析数据
从 data/reports/*.json 中读取完整 AI 分析，更新到 favorites 表
"""

import json
import os
from pathlib import Path
from supabase import create_client, Client

# Supabase 配置
SUPABASE_URL = "https://bvhzexdluniqdwmsxaxw.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_KEY:
    print("❌ 错误：请设置环境变量 SUPABASE_SERVICE_KEY")
    exit(1)

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def load_all_reports():
    """加载所有日报 JSON 文件，建立 URL -> item 的映射"""
    url_map = {}
    reports_dir = Path("data/reports")
    
    if not reports_dir.exists():
        print(f"❌ 错误：{reports_dir} 目录不存在")
        return url_map
    
    for json_file in reports_dir.glob("*.json"):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                report = json.load(f)
                date = report.get("date", "")
                items = report.get("items", [])
                
                for item in items:
                    url = item.get("url", "")
                    if url:
                        url_map[url] = {
                            "what": item.get("what", ""),
                            "industry_use": item.get("industry_use", ""),
                            "capability": item.get("capability", ""),
                            "assessment": item.get("assessment", ""),
                            "risk": item.get("risk", ""),
                            "importance": item.get("importance", 3),
                            "date": date
                        }
        except Exception as e:
            print(f"⚠️ 读取 {json_file} 失败：{e}")
    
    return url_map

def backfill_favorites():
    """回填收藏的 AI 分析数据"""
    print("📖 加载日报数据...")
    url_map = load_all_reports()
    print(f"✅ 加载了 {len(url_map)} 条日报数据")
    
    print("\n📖 读取收藏夹数据...")
    response = sb.table("favorites").select("*").execute()
    favorites = response.data
    
    if not favorites:
        print("✅ 收藏夹为空，无需回填")
        return
    
    print(f"✅ 读取了 {len(favorites)} 条收藏")
    
    # 统计
    total = len(favorites)
    updated = 0
    skipped = 0
    not_found = 0
    
    print("\n🔄 开始回填...")
    for fav in favorites:
        url = fav.get("url", "")
        
        # 如果已有 AI 分析数据，跳过
        if fav.get("what") or fav.get("industry_use"):
            skipped += 1
            continue
        
        # 查找对应的日报数据
        if url not in url_map:
            print(f"  ⚠️ 未找到：{fav.get('title', '')[:30]}...")
            not_found += 1
            continue
        
        # 更新
        item_data = url_map[url]
        update_data = {
            "what": item_data["what"],
            "industry_use": item_data["industry_use"],
            "capability": item_data["capability"],
            "assessment": item_data["assessment"],
            "risk": item_data["risk"],
            "importance": item_data["importance"]
        }
        
        try:
            sb.table("favorites").update(update_data).eq("url", url).execute()
            updated += 1
            print(f"  ✅ 更新：{fav.get('title', '')[:30]}...")
        except Exception as e:
            print(f"  ❌ 失败：{fav.get('title', '')[:30]}... - {e}")
    
    print(f"\n{'='*60}")
    print(f"📊 回填完成：")
    print(f"  - 总计：{total} 条")
    print(f"  - 已更新：{updated} 条")
    print(f"  - 已跳过（有数据）：{skipped} 条")
    print(f"  - 未找到：{not_found} 条")
    print(f"{'='*60}")

if __name__ == "__main__":
    print("="*60)
    print("Phase 3.3c: 回填收藏的 AI 分析数据")
    print("="*60)
    backfill_favorites()

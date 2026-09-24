"""SQLite 持久化：URL/标题去重 + 历史查询 + 自动清理"""
import os
import sqlite3
from datetime import datetime, timezone, timedelta

BASE = os.path.join(os.path.dirname(__file__), "..")
DB_PATH = os.path.join(BASE, "data", "radar.db")

# Jaccard 相似度阈值（标题模糊匹配）
SIMILARITY_THRESHOLD = 0.6


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS items (
            url TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            source TEXT NOT NULL,
            date TEXT NOT NULL,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            importance INTEGER DEFAULT 3,
            history_dates TEXT DEFAULT ''
        )
    """)
    # 兼容旧表：添加 history_dates 列（如果不存在）
    try:
        conn.execute("ALTER TABLE items ADD COLUMN history_dates TEXT DEFAULT ''")
    except Exception:
        pass  # 列已存在
    conn.execute("CREATE INDEX IF NOT EXISTS idx_title ON items(title)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON items(date)")
    conn.commit()
    return conn


def insert_items(items, date_str, importance_map=None):
    """
    将 items 列表写入 SQLite。已存在的 URL 更新 last_seen 并追加日期到 history_dates；
    importance_map: {url: int} 可选，AI 解读后的 importance 分数
    """
    importance_map = importance_map or {}
    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    conn = _connect()
    inserted = 0
    updated = 0
    for item in items:
        url = item.get("url", "")
        if not url:
            continue
        title = item.get("title", "")
        source = item.get("source", "")
        imp = importance_map.get(url, item.get("importance", 3))
        try:
            conn.execute(
                "INSERT INTO items (url, title, source, date, first_seen, last_seen, importance, history_dates) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (url, title, source, date_str, now, now, imp, date_str)
            )
            inserted += 1
        except sqlite3.IntegrityError:
            # 已存在：追加日期到 history_dates，更新 last_seen 和 importance
            row = conn.execute(
                "SELECT history_dates FROM items WHERE url=?", (url,)
            ).fetchone()
            existing_dates = row[0] if row and row[0] else ""
            date_list = [d.strip() for d in existing_dates.split(",") if d.strip()]
            if date_str not in date_list:
                date_list.append(date_str)
            new_history = ",".join(sorted(set(date_list)))
            conn.execute(
                "UPDATE items SET last_seen=?, importance=?, history_dates=? WHERE url=?",
                (now, imp, new_history, url)
            )
            updated += 1
    conn.commit()
    conn.close()
    return inserted, updated


def find_previous_dates(url, title, current_date, limit=3):
    """
    查找该条目在哪些历史日期出现过。
    精确匹配 URL 的 history_dates 字段，或标题 Jaccard >= 0.6 的 history_dates。
    返回去重后的日期列表（降序，排除 current_date，最多 limit 个）。
    """
    conn = _connect()
    dates = set()

    # 精确匹配 URL：查询该 URL 的 history_dates
    row = conn.execute(
        "SELECT history_dates FROM items WHERE url=?", (url,)
    ).fetchone()
    if row and row["history_dates"]:
        for d in row["history_dates"].split(","):
            d = d.strip()
            if d and d < current_date:
                dates.add(d)

    # 如果已经匹配到 limit 个，直接返回
    if len(dates) >= limit:
        conn.close()
        return sorted(dates, reverse=True)[:limit]

    # 模糊匹配标题：查询所有历史记录的 title 和 history_dates
    rows = conn.execute(
        "SELECT title, history_dates FROM items WHERE history_dates != ''"
    ).fetchall()
    conn.close()

    title_lower = title.lower()
    for r in rows:
        if len(dates) >= limit:
            break
        if _jaccard(r["title"].lower(), title_lower) >= SIMILARITY_THRESHOLD:
            # 将该记录的 history_dates 中早于 current_date 的日期加入结果
            if r["history_dates"]:
                for d in r["history_dates"].split(","):
                    d = d.strip()
                    if d and d < current_date:
                        dates.add(d)

    return sorted(dates, reverse=True)[:limit]


def get_top_historical(min_date, limit=20, min_importance=4):
    """获取历史中 importance >= min_importance 的高分条目（用于 Top 5 补全）"""
    conn = _connect()
    rows = conn.execute(
        "SELECT url, title, source, date, importance FROM items "
        "WHERE date >= ? AND importance >= ? "
        "ORDER BY importance DESC, last_seen DESC LIMIT ?",
        (min_date, min_importance, limit)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def cleanup_old(days=90):
    """清理 N 天前的数据"""
    cutoff = (datetime.now(timezone(timedelta(hours=8))) - timedelta(days=days)).strftime("%Y-%m-%d")
    conn = _connect()
    cur = conn.execute("DELETE FROM items WHERE date < ?", (cutoff,))
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    if deleted:
        print(f"SQLite cleanup: 删除 {deleted} 条 {days} 天前的记录")
    return deleted


def _jaccard(a, b):
    """基于字符 bigram 的 Jaccard 相似度"""
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa = set(a[i:i + 2] for i in range(len(a) - 1))
    sb = set(b[i:i + 2] for i in range(len(b) - 1))
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def stats():
    """返回数据库统计信息"""
    conn = _connect()
    total = conn.execute("SELECT COUNT(*) as c FROM items").fetchone()["c"]
    sources = conn.execute("SELECT source, COUNT(*) as c FROM items GROUP BY source ORDER BY c DESC").fetchall()
    conn.close()
    return {"total": total, "sources": {r["source"]: r["c"] for r in sources}}

"""抓取多个信息源，输出 data/raw.json

数据源：GitHub Trending / Rising、Hacker News (>=50pts)、HuggingFace、
        Product Hunt、Reddit r/MachineLearning (>=50ups)、量子位、36氪（48h 内）
"""
import json
import os
import re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

import requests

BASE = os.path.join(os.path.dirname(__file__), "..")
HEADERS = {"User-Agent": "ai-daily-radar/1.0 (personal news bot)"}
OUT = os.path.join(BASE, "data", "raw.json")

AI_KEYWORDS = re.compile(
    r"\bAI\b|\bLLM|GPT|Claude|Gemini|DeepSeek|Qwen|Kimi|agent|diffusion|transformer|"
    r"neural|machine learning|open.?source model|multimodal|RAG|inference", re.I)

CN_KEYWORDS = re.compile(r"AI|大模型|智能|GPT|模型|机器人|算法|自动驾驶|Agent", re.I)

# ─── 来源权重过滤 ─────────────────────────────────────────────
HN_MIN_POINTS = 50          # HN 低于 50 points 的不抓
REDDIT_MIN_UPVOTES = 50     # Reddit 低于 50 upvotes 的不抓
RSS_MAX_HOURS = 48          # RSS 只保留 48h 内的条目


def get(url, **kw):
    r = requests.get(url, headers=HEADERS, timeout=30, **kw)
    r.raise_for_status()
    return r


def _parse_rss_time(entry):
    """解析 RSS 条目的发布时间，返回 datetime 或 None"""
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            try:
                from time import mktime
                return datetime.fromtimestamp(mktime(t), tz=timezone.utc)
            except Exception:
                pass
    for key in ("published", "updated"):
        s = entry.get(key, "")
        if s:
            try:
                return parsedate_to_datetime(s)
            except Exception:
                pass
    return None


def _is_recent(entry, max_hours=RSS_MAX_HOURS):
    """判断 RSS 条目是否在 max_hours 小时内。无时间戳则保留（兼容部分 RSS）"""
    t = _parse_rss_time(entry)
    if t is None:
        return True
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_hours)
    return t >= cutoff


def fetch_github_trending(limit=8):
    """GitHub 今日趋势榜（网页抓取，失败自动重试 2 次）"""
    from bs4 import BeautifulSoup
    items = []
    for attempt in range(3):
        try:
            soup = BeautifulSoup(get("https://github.com/trending?since=daily").text, "html.parser")
            for row in soup.select("article.Box-row")[:limit]:
                a = row.select_one("h2 a")
                if not a:
                    continue
                name = "/".join(a.get_text(strip=True).split())
                desc_tag = row.select_one("p")
                stars_tag = row.select_one("a.Link--muted")
                lang_tag = row.select_one('[itemprop="programmingLanguage"]')
                items.append({
                    "source": "GitHub 趋势榜",
                    "title": name,
                    "url": "https://github.com" + a["href"],
                    "description": desc_tag.get_text(strip=True) if desc_tag else "",
                    "extra": f"{lang_tag.get_text(strip=True) if lang_tag else ''} | {stars_tag.get_text(strip=True) if stars_tag else ''}",
                })
            if items:
                break
        except Exception as e:
            print(f"github trending attempt {attempt + 1} failed:", e)
    return items


def fetch_github_rising(limit=6):
    """近 7 天新建的高星项目（官方 API）"""
    items = []
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
        data = get("https://api.github.com/search/repositories",
                   params={"q": f"created:>{since} stars:>100", "sort": "stars",
                           "order": "desc", "per_page": limit}).json()
        for r in data.get("items", []):
            items.append({
                "source": "GitHub 新星项目",
                "title": r["full_name"],
                "url": r["html_url"],
                "description": r.get("description") or "",
                "extra": f"{r.get('language') or ''} | ⭐ {r['stargazers_count']} | 新建于 {r['created_at'][:10]}",
            })
    except Exception as e:
        print("github rising failed:", e)
    return items


def fetch_hackernews(limit=8):
    """Hacker News 首页中的 AI 相关热帖（Algolia 官方 API，>= 50 points）"""
    items = []
    try:
        data = get("https://hn.algolia.com/api/v1/search",
                   params={"tags": "front_page", "hitsPerPage": 100}).json()
        for h in data.get("hits", []):
            points = h.get("points", 0) or 0
            if points < HN_MIN_POINTS:
                continue
            if AI_KEYWORDS.search(h.get("title") or ""):
                items.append({
                    "source": "Hacker News",
                    "title": h["title"],
                    "url": h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}",
                    "description": f"{points} points | {h.get('num_comments', 0)} 评论",
                    "extra": "",
                })
            if len(items) >= limit:
                break
    except Exception as e:
        print("hackernews failed:", e)
    return items


def fetch_huggingface(limit=6):
    """HuggingFace 热门模型榜"""
    items = []
    for sort in ("likes7d", "trendingScore", "likes"):
        try:
            data = get("https://huggingface.co/api/models",
                       params={"sort": sort, "direction": -1, "limit": limit}).json()
            if not isinstance(data, list) or not data:
                continue
            for m in data:
                items.append({
                    "source": "HuggingFace 热门模型",
                    "title": m.get("id", ""),
                    "url": f"https://huggingface.co/{m.get('id','')}",
                    "description": f"任务: {m.get('pipeline_tag') or '通用'}",
                    "extra": f"❤ {m.get('likes', 0)} | 下载 {m.get('downloads', 0)}",
                })
            if items:
                break
        except Exception as e:
            print(f"huggingface sort={sort} failed:", e)
    return items


def fetch_producthunt(limit=6):
    """Product Hunt 最近 24h 热门产品（RSS 抓取）"""
    import feedparser
    items = []
    try:
        d = feedparser.parse(get("https://www.producthunt.com/feed").text)
        for e in d.entries[:limit]:
            title = e.get("title", "")
            link = e.get("link", "")
            desc = re.sub(r"<[^>]+>", "", e.get("summary", ""))[:200]
            pub = e.get("published", "")[:16]
            if title:
                items.append({
                    "source": "Product Hunt",
                    "title": title,
                    "url": link,
                    "description": desc,
                    "extra": pub,
                })
    except Exception as e:
        print("producthunt failed:", e)
    return items


def fetch_reddit(limit=8):
    """Reddit r/MachineLearning 热门帖子（JSON API，>= 50 upvotes）"""
    items = []
    try:
        data = get("https://www.reddit.com/r/MachineLearning/hot.json",
                   params={"limit": 50}).json()
        for child in data.get("data", {}).get("children", []):
            p = child.get("data", {})
            score = p.get("score", 0)
            if score < REDDIT_MIN_UPVOTES:
                continue
            title = p.get("title", "")
            permalink = p.get("permalink", "")
            url = f"https://www.reddit.com{permalink}" if permalink else ""
            items.append({
                "source": "Reddit ML",
                "title": title,
                "url": url,
                "description": f"{score} upvotes | {p.get('num_comments', 0)} 评论",
                "extra": "",
            })
            if len(items) >= limit:
                break
    except Exception as e:
        print("reddit failed:", e)
    return items


def fetch_cn_news(limit=12):
    """国内 AI 媒体 RSS（量子位 / 36 氪，48h 内，AI 关键词过滤）"""
    import feedparser
    items = []
    per_feed = max(1, limit // 2)
    feeds = [
        ("量子位", "https://www.qbitai.com/feed", False),
        ("36 氪", "https://36kr.com/feed", True),
    ]
    for name, url, need_filter in feeds:
        count = 0
        try:
            d = feedparser.parse(get(url).text)
            for e in d.entries:
                title = e.get("title", "")
                # 时间过滤：只保留 48h 内
                if not _is_recent(e):
                    continue
                # 关键词过滤
                if need_filter and not (CN_KEYWORDS.search(title) or
                                        CN_KEYWORDS.search(e.get("summary", ""))):
                    continue
                items.append({
                    "source": name,
                    "title": title,
                    "url": e.get("link", ""),
                    "description": re.sub(r"<[^>]+>", "", e.get("summary", ""))[:200],
                    "extra": e.get("published", "")[:16],
                })
                count += 1
                if count >= per_feed:
                    break
        except Exception as e:
            print(f"{name} rss failed:", e)
    return items


def main():
    all_items = []
    sources_status = {}

    for name, fn in [
        ("GitHub 趋势榜", fetch_github_trending),
        ("GitHub 新星项目", fetch_github_rising),
        ("Hacker News", fetch_hackernews),
        ("HuggingFace 热门模型", fetch_huggingface),
        ("Product Hunt", fetch_producthunt),
        ("Reddit ML", fetch_reddit),
        ("国内媒体", fetch_cn_news),
    ]:
        items = fn()
        sources_status[name] = len(items)
        all_items.extend(items)
        print(f"  {name}: {len(items)} 条")

    report = {
        "fetched_at": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M (北京时间)"),
        "items": all_items,
        "sources_status": sources_status,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"OK: {len(all_items)} items -> {OUT}")


if __name__ == "__main__":
    main()

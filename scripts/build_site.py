"""读取 data/reports/*.json 和 data/digests/*.json，生成 docs/ 下的静态网页（GitHub Pages 发布源）"""
import glob
import html
import re

_COLOR_EMOJI = re.compile(r"[🌀-🫿✀-➿]️?")
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta

# 确保 data/ 目录下的模块可导入
DATA_DIR = os.path.join(BASE := os.path.join(os.path.dirname(__file__), ".."), "data")
if DATA_DIR not in sys.path:
    sys.path.insert(0, DATA_DIR)

from story_grouping import group_stories
from store import insert_items, find_previous_dates, get_top_historical, cleanup_old


def _read_favjs_version():
    """从 docs/fav-core.js 读取 APP_VERSION 作为唯一版本来源（消除双写）"""
    fav_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "fav-core.js")
    try:
        m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"',
                      open(fav_path, encoding="utf-8").read())
        if m:
            return m.group(1)
    except OSError:
        pass
    print("警告: 无法从 fav-core.js 读取 APP_VERSION，缓存破坏参数退化为 dev")
    return "dev"


FAVJS_VER = _read_favjs_version()

# 数据版本（构建时间戳）：history 片段 URL 携带，每次构建强制浏览器刷新片段缓存。
# 与 fav-core.js 的 APP_VERSION（代码版本）语义分离：AI 字段修订后无需手动升代码版本。
BUILD_TS = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

REPORTS_DIR = os.path.join(BASE, "data", "reports")
DIGESTS_DIR = os.path.join(BASE, "data", "digests")
DOCS = os.path.join(BASE, "docs")
ARCHIVE = os.path.join(DOCS, "archive")
DIGESTS_OUT = os.path.join(DOCS, "digests")

STARS = {1: "1/5", 2: "2/5", 3: "3/5", 4: "4/5", 5: "5/5"}

CSS_VER = "3.3d-17"
CSS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "style.css")
with open(CSS_PATH, encoding="utf-8") as _f:
    CSS = _f.read()


PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
{ogmeta}
<title>AI 日报雷达 · {title}</title>
<link rel="stylesheet" href="{css}">
</head>
<body data-page="{pagetype}">
<header class="top"><div class="top-inner">
  <h1>{heading}</h1>
  <div class="meta">{meta}</div>
  <span class="badge">{mode}</span>
  <div class="nav" style="display:flex;align-items:center">{nav}<div class="adr-nav-auth"><span class="adr-user-email" id="adr-user-info"></span><button class="adr-login-btn" id="adr-login-btn" onclick="document.getElementById('adr-login-modal').style.display='flex'">登录</button><button class="adr-logout-btn" id="adr-logout-btn" onclick="adrLogout()">登出</button></div></div>
</div></header>
<div class="wrap">
{body}
<footer>由 GitHub Actions 自动生成 · 解读由 Kimi 提供 · 仅供个人学习参考</footer>
</div>
<div class="adr-modal-overlay" id="adr-login-modal">
  <div class="adr-modal" style="position:relative">
    <button class="adr-modal-close" onclick="document.getElementById('adr-login-modal').style.display='none'">&times;</button>
    <h3>登录</h3>
    <div class="adr-auth-tabs">
      <button class="adr-auth-tab active" id="adr-tab-password" onclick="adrSwitchTab('password')">密码登录</button>
      <button class="adr-auth-tab" id="adr-tab-otp" onclick="adrSwitchTab('otp')">验证码登录</button>
    </div>
    <div id="adr-login-password-tab">
      <input type="email" id="adr-login-email-pw" placeholder="your@email.com" onkeydown="if(event.key==='Enter')document.getElementById('adr-login-password').focus()">
      <input type="password" id="adr-login-password" placeholder="密码" onkeydown="if(event.key==='Enter')adrLoginWithPassword()">
      <button class="adr-modal-btn" id="adr-login-pw-btn" onclick="adrLoginWithPassword()">登录</button>
      <button class="adr-forgot-link" onclick="adrShowForgotPassword()">忘记密码？</button>
    </div>
    <div id="adr-login-otp-tab" style="display:none">
      <div id="adr-login-step1">
        <input type="email" id="adr-login-email" placeholder="your@email.com" onkeydown="if(event.key==='Enter')adrSendCode()">
        <button class="adr-modal-btn" id="adr-login-submit" onclick="adrSendCode()">发送验证码</button>
      </div>
      <div id="adr-login-step2" style="display:none">
        <input type="text" id="adr-login-code" placeholder="输入验证码" maxlength="10" style="letter-spacing:4px;text-align:center;font-size:20px" onkeydown="if(event.key==='Enter')adrVerifyCode()">
        <button class="adr-modal-btn" id="adr-login-verify" onclick="adrVerifyCode()">确认登录</button>
        <div style="margin-top:8px;font-size:13px"><a href="#" onclick="adrResendCode();return false" class="sync-status">没收到？重新发送</a></div>
      </div>
    </div>
    <div id="adr-forgot-section" style="display:none">
      <p class="hint">输入邮箱，我们将发送密码重置链接</p>
      <input type="email" id="adr-forgot-email" placeholder="your@email.com" onkeydown="if(event.key==='Enter')adrSendPasswordReset()">
      <button class="adr-modal-btn" id="adr-forgot-btn" onclick="adrSendPasswordReset()">发送重置链接</button>
      <button class="adr-forgot-link" onclick="adrBackToLogin()" style="margin-top:12px">← 返回登录</button>
    </div>
    <div class="adr-modal-msg" id="adr-login-msg"></div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
{favjs}{historyjs}
<!-- 打印 / 复制链接：交给浏览器自带的打印引擎完成，不再引入任何 PDF 渲染库
     （旧的截图式导出会产出 264MB 且无超链接）。只有需要按钮的页面传脚本，其余传空串。 -->
<script src="{printjs}"></script>
</body>
</html>"""




def esc(s):
    return html.escape(str(s or ""))


def og_meta(title, description):
    """分享预览用。html.escape 默认转义引号，可安全放进属性值。"""
    t = esc(title)
    d = esc(description)
    return (f'<meta property="og:title" content="{t}">'
            f'<meta property="og:description" content="{d}">'
            f'<meta property="og:type" content="article">'
            f'<meta name="description" content="{d}">')


def _top_desc(rep, limit=120):
    """取当期第一条标题做预览描述。"""
    for item in rep.get("items", []):
        t = (item.get("title") or "").strip()
        if t:
            return t[:limit]
    return ""


def action_bar(kind, with_copy):
    """kind: daily（首页/期次页）| favorites（收藏页）"""
    bar = '<div class="share-bar">'
    if with_copy:
        bar += ('<button class="action-btn copy-link-btn" type="button" '
                'onclick="adrCopyIssueLink()"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>复制链接</button>')
    bar += (f'<button class="action-btn" type="button" '
            f'onclick="adrPrint(\'{kind}\')">'
            '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6V2.5h7V6"/>'
            '<rect x="2" y="6" width="12" height="5.5" rx="1"/><path d="M4.5 9.5h7v4h-7z"/></svg>'
            '打印 / 存为 PDF</button>')
    bar += '</div>'
    return bar


def fav_bar(prefix):
    return (f'<div class="fav-bar"><a href="{prefix}favorites.html">'
            f'★ 我的收藏夹（<span class="fav-chip" id="fav-chip">0</span>条）'
            f'· 点条目旁的 ☆ 即可收藏</a></div>')


def _lookup_url(title, url_by_title, all_titles):
    """根据标题查找 URL：精确匹配 → 子串匹配 → 字符重叠度匹配 → 返回 None

    AI 合成的 top_pick 标题经常是原始标题的缩写或改写，
    例如合成"领克坠崖事故出圈"，原始标题"智能不出彩的「领克」，刚靠一次坠崖事故出圈了"。
    子串匹配失败时用字符重叠度兜底。
    """
    if not title:
        return None
    if title in url_by_title:
        return url_by_title[title]
    # 子串匹配
    for orig_title, url in url_by_title.items():
        if title in orig_title or orig_title in title:
            return url
    # 字符重叠度匹配（短标题的字符有多少比例出现在原标题中）
    best_url, best_ratio = None, 0.0
    for orig_title, url in url_by_title.items():
        chars = set(title)
        if not chars:
            continue
        matched = sum(1 for c in chars if c in orig_title)
        ratio = matched / len(chars)
        if ratio > best_ratio:
            best_ratio = ratio
            best_url = url
    if best_ratio >= 0.5:
        return best_url
    return None


def _render_pick(title, reason, url):
    """渲染 top_pick 条目：有 URL 则生成链接，否则只显示粗体文字"""
    title_esc = esc(title)
    reason_esc = esc(reason)
    if url:
        return (f'<div class="trend"><a href="{esc(url)}" '
                f'target="_blank" rel="noopener"><b>{title_esc}</b></a>'
                f'<br>{reason_esc}</div>')
    return f'<div class="trend"><b>{title_esc}</b><br>{reason_esc}</div>'


def _day_label(date):
    """把 YYYY-MM-DD 格式化成「11月6日」；异常时回退原字符串"""
    try:
        return f"{int(date[5:7])}月{int(date[8:10])}日"
    except Exception:
        return str(date or "")


def render_summary(rep, date="", is_latest=True):
    s = rep.get("summary")
    if not s:
        return ""
    # 标题文案（UI 评审：历史期用日期锚定，区块名中性；格式化在此统一生成，避免调用点漂移）
    if is_latest:
        head_title = "今日总结 · AI 主编解读"
        overview_label = "今日总览"
    else:
        head_title = _day_label(date) + "总结 · AI 主编解读"
        overview_label = "当日总览"
    url_by_title = {i.get("title"): i.get("url") for i in rep["items"]}
    all_titles = list(url_by_title.keys())
    conclusions = "".join(f'<div class="trend">{esc(c)}</div>' for c in s.get("conclusions", []))
    picks = "".join(
        _render_pick(p.get("title", ""), p.get("reason", ""),
                     _lookup_url(p.get("title", ""), url_by_title, all_titles))
        for p in s.get("top_picks", []))
    overview_brief = esc((s.get("overview") or "")[:100])
    summary_btn = ""
    if date:
        summary_btn = (f'<button class="fav-btn" title="收藏" '
                       f'data-t="今日总结 · {esc(date)}" data-u="summary://{esc(date)}" '
                       f'data-s="AI 日报总结" data-d="{esc(date)}" '
                       f'data-b="{overview_brief}">☆</button>')
    return f"""<div class="card summary-card">
<h2 class="summary-title">{head_title}{summary_btn}</h2>
<dl>
<dt>{overview_label}</dt><dd>{esc(s.get("overview"))}</dd>
<dt>核心结论</dt><dd>{conclusions}</dd>
<dt>今日重点关注</dt><dd>{picks}</dd>
<dt>对我的行业有什么用？</dt><dd>{esc(s.get("industry_use"))}</dd>
<dt>风险提示</dt><dd>{esc(s.get("risks"))}</dd>
</dl></div>"""


def similar_badge(dates):
    if not dates:
        return ""
    date_links = "、".join(f"<b>{esc(d)}</b>" for d in dates)
    return f'<div class="similar">此前曾在 {date_links} 出现</div>'


def fav_btn(i, date, brief):
    """Phase 3.3c: 收藏按钮传递完整 AI 分析数据"""
    return (f'<button class="fav-btn" title="收藏" '
            f'data-t="{esc(i.get("title"))}" data-u="{esc(i.get("url"))}" '
            f'data-s="{esc(i.get("source"))}" data-d="{esc(date)}" '
            f'data-b="{esc(brief)}" '
            f'data-what="{esc(i.get("what", ""))}" '
            f'data-industry-use="{esc(i.get("industry_use", ""))}" '
            f'data-capability="{esc(i.get("capability", ""))}" '
            f'data-assessment="{esc(i.get("assessment", ""))}" '
            f'data-risk="{esc(i.get("risk", ""))}" '
            f'data-importance="{esc(i.get("importance", 3))}">☆</button>')


def render_card(i, ai, date="", similar_dates=None, top5=False, variant="full"):
    """唯一的卡片产出函数。variant="full" 用于日报期次；
    variant="compact" 用于周期汇总（月报数百条，完整卡片会膨胀数倍）。"""
    similar_dates = similar_dates or []
    if variant == "compact":
        cstar = (f' <span class="tag-star">{STARS.get(int(i["importance"]), "")}</span>'
                 if ai and i.get("importance") else "")
        cbrief = i.get("brief") or i.get("what") or ""
        return (f'<div class="item-line"><span class="tag-src">{esc(i.get("source"))}</span>'
                f'<a href="{esc(i.get("url"))}" target="_blank" rel="noopener">{esc(i.get("title"))}</a>{cstar}'
                f'{fav_btn(i, date, cbrief)}</div>{similar_badge(similar_dates)}')
    title = esc(i.get("title"))
    url = esc(i.get("url"))
    src = esc(i.get("source"))
    # GitHub star 数：去掉星形符号改纯文字，避免与「收藏按钮 ☆」混淆
    _ex = re.sub(r"[⭐★☆]\s*([0-9,]+)", r"\1 stars", i.get("extra", "") or "")
    _ex = re.sub(r"[❤♥♡]\s*([0-9,]+)", r"\1 喜欢", _ex)
    _ex = _COLOR_EMOJI.sub("", _ex)
    _ex = _ex.replace("|", "·")
    extra = esc(_ex)
    star = ""
    if ai and i.get("importance"):
        star = f'<span class="tag-star">{STARS.get(int(i["importance"]), "")}</span>'
    brief = i.get("brief") or i.get("what") or i.get("description") or ""
    top5_tag = '<span class="top5-badge">历史补全</span>' if top5 else ''
    tag_items = f'<span class="tag-src">{src}</span>'
    if star:
        tag_items += star
    if extra:
        tag_items += f'<span class="tag-extra">{extra}</span>'
    head = (f'<h2><a href="{url}" target="_blank" rel="noopener">{title}</a>'
            f'{fav_btn(i, date, brief)}{top5_tag}</h2>'
            f'<div class="tags">{tag_items}</div>')
    if not ai:
        return (f'<div class="card raw">{head}<p>{esc(i.get("description"))}</p>'
                f'{similar_badge(similar_dates)}</div>')
    fields = [("这是什么？", "what"), ("对我的行业有什么用？", "industry_use"),
              ("这能干什么？", "capability"), ("评估与判断", "assessment"),
              ("风险与应用场景", "risk")]
    detail = "".join(f'<dt>{label}</dt><dd>{esc(i.get(key))}</dd>'
                     for label, key in fields if i.get(key))
    return (f"<div class='card'>{head}"
            f'<p class="brief">{esc(brief)}</p>'
            f'<details><summary>展开完整分析</summary>'
            f'{similar_badge(similar_dates)}<dl>{detail}</dl></details></div>')


def render_story_group(story, ai, date="", similar_dates_map=None):
    """渲染一个故事组（多源报道同一事件）"""
    similar_dates_map = similar_dates_map or {}
    if len(story["items"]) <= 1:
        return render_card(story["items"][0], ai, date,
                           similar_dates_map.get(story["items"][0].get("url")))
    # 多条目 Story
    header = (f'<div class="story-group-header">'
              f'{story["source_count"]} 个来源报道了同一事件</div>')
    cards = "\n".join(
        render_card(item, ai, date,
                    similar_dates_map.get(item.get("url")))
        for item in story["items"]
    )
    return f'<div class="story-group">{header}{cards}</div>'


def build_daily():
    os.makedirs(ARCHIVE, exist_ok=True)
    files = sorted(glob.glob(os.path.join(REPORTS_DIR, "*.json")), reverse=True)
    if not files:
        return []

    # 加载全部报告
    reports = [json.load(open(f, encoding="utf-8")) for f in files]

    # ─── SQLite: 写入所有历史数据 + 查询相似度 ─────────────────
    # 先插入历史报告（从旧到新），再插入最新报告
    for rep in reversed(reports):
        imp_map = {i.get("url", ""): i.get("importance", 3) for i in rep["items"]}
        insert_items(rep["items"], rep["date"], imp_map)

    latest = reports[0]
    latest_date = latest["date"]

    # 为每条 item 标注 _similar_dates（从 SQLite 查询）
    for rep in reports:
        for item in rep["items"]:
            item["_similar_dates"] = find_previous_dates(
                item.get("url", ""), item.get("title", ""), rep["date"])

    # ─── 当日故事分组 ─────────────────────────────────────────
    stories = group_stories(latest["items"])

    # ─── Top 5 补全 ───────────────────────────────────────────
    # 当日 importance >= 4 的条目不足 5 个时，从历史补全
    # 构建 URL→原始条目 索引，用于回溯 AI 分析字段
    url_to_original = {}
    for rep in reports:
        for item in rep["items"]:
            u = item.get("url", "")
            if u and u not in url_to_original:
                url_to_original[u] = item

    high_imp = [i for i in latest["items"] if i.get("importance", 3) >= 4]
    top5_extra = []
    if len(high_imp) < 5:
        need = 5 - len(high_imp)
        existing_urls = {i.get("url") for i in latest["items"]}
        hist = get_top_historical(
            min_date=(datetime.now(timezone(timedelta(hours=8))) - timedelta(days=30)).strftime("%Y-%m-%d"),
            limit=need * 3, min_importance=4)
        for h in hist:
            if h["url"] not in existing_urls and len(top5_extra) < need:
                # 回溯原始报告，合并 AI 分析字段
                orig = url_to_original.get(h["url"], {})
                for key in ("what", "industry_use", "capability", "assessment", "risk", "brief", "description", "extra"):
                    if orig.get(key) and not h.get(key):
                        h[key] = orig[key]
                h["_from_history"] = True
                h["source"] = h.get("source", "") + " (历史补全)"
                h["_similar_dates"] = []
                top5_extra.append(h)
                existing_urls.add(h["url"])

    dates = [r["date"] for r in reports]

    # ─── 渲染辅助 ─────────────────────────────────────────────
    sim_map = {i.get("url"): i.get("_similar_dates", []) for i in latest["items"]}

    def render_items_for_index():
        """渲染当日 index.html 的内容（故事分组 + Top 5 补全）"""
        ai = latest.get("ai_enabled")
        parts = []
        # 故事分组渲染
        rendered_urls = set()
        for story in stories:
            if len(story["items"]) > 1:
                parts.append(render_story_group(story, ai, latest_date, sim_map))
                for si in story["items"]:
                    rendered_urls.add(si.get("url"))
            else:
                item = story["items"][0]
                if item.get("url") not in rendered_urls:
                    parts.append(render_card(item, ai, latest_date,
                                             sim_map.get(item.get("url"))))
                    rendered_urls.add(item.get("url"))
        # Top 5 补全条目
        for h in top5_extra:
            parts.append(render_card(h, ai, latest_date, [], top5=True))
        return "\n".join(parts)

    # 生成 archive 页面（不用故事分组，保持原样）
    for rep in reports:
        cards = "\n".join(
            render_card(i, rep.get("ai_enabled"), rep["date"], i.get("_similar_dates", []))
            for i in rep["items"]
        )
        links = "".join(f'<a href="{d}.html">{d}</a>' for d in dates)
        page = PAGE.format(
            title=rep["date"], css="../style.css?v=" + CSS_VER, heading="AI 日报雷达",
            meta=f'数据抓取时间：{esc(rep["fetched_at"])} · 共 {len(rep["items"])} 条',
            mode="AI 深度解读" if rep.get("ai_enabled") else "原始榜单（未配置 API 密钥）",
            nav='<a href="../index.html">最新日报</a><a href="../digests/index.html">周期汇总（周/月/季）</a><a href="../favorites.html">我的收藏夹</a>',
            favjs=f'<script src="../fav-core.js?v={FAVJS_VER}"></script>',
            pagetype="archive",
            printjs="../print.js",
            ogmeta=og_meta(f"AI 日报雷达 · {rep['date']}", _top_desc(rep)),
            historyjs="",
            body=f'<script>sessionStorage.setItem("adr_report","archive/{rep["date"]}.html");window.ADR_SHARE_DATE="{rep["date"]}";</script>'
                 + fav_bar("../") + action_bar("daily", True)
                 + render_summary(rep, rep["date"]) + cards + f'<div class="archive"><b>历史日报：</b>{links}</div>')
        with open(os.path.join(ARCHIVE, f"{rep['date']}.html"), "w", encoding="utf-8") as fo:
            fo.write(page)

    # 生成 index.html：当日完整展示（含故事分组 + Top 5 补全） + 历史折叠
    latest_cards = render_items_for_index()

    # ── 期次片段：仅历史期（最新期用 index 的 SSR 内容，前端缓存恢复）──
    # 评审依据：最新期 SSR 含故事分组+Top5，用 render_card 重造成片段会导致
    # "切走再切回"结构不一致；故只为历史期生成片段，最新期由前端缓存 DOM 恢复。
    history_dir = os.path.join(DOCS, "history")
    os.makedirs(history_dir, exist_ok=True)
    issue_index = []
    for rep in reports:
        d = rep["date"]
        issue_index.append({"date": d, "count": len(rep["items"])})
        if d == latest["date"]:
            continue  # 最新期不产片段（见上）
        parts = []
        if rep.get("summary"):
            parts.append(render_summary(rep, d, is_latest=False))
        elif rep.get("ai_enabled") is False or not rep.get("summary"):
            # 无 AI 解读的早期期次：中性说明条（UI 评审：非警告色，占 summary 位）
            parts.append('<div class="card no-ai-note"><div class="no-ai-text">'
                         '该期暂无 AI 解读，仅显示原始条目</div></div>')
        parts.extend(
            render_card(i, rep.get("ai_enabled"), d, i.get("_similar_dates", []))
            for i in rep["items"]
        )
        # 构建原子性：片段先写，index.html 最后写
        with open(os.path.join(history_dir, f"{d}.html"), "w", encoding="utf-8") as fo:
            fo.write("\n".join(parts))

    # 清理不属于历史期的残留片段（最新期不产片段；已删除的期次也一并清掉）
    _keep = {r["date"] for r in reports if r["date"] != latest["date"]}
    for _f in os.listdir(history_dir):
        if _f.endswith(".html") and _f[:-5] not in _keep:
            os.remove(os.path.join(history_dir, _f))

    # 期次索引内联（技术评审裁剪：不做独立索引文件，避免额外请求与版本错配）
    issue_index_json = json.dumps(issue_index, ensure_ascii=False, separators=(",", ":"))
    archive_div = ""

    # 时段分析器 HTML
    range_analyzer = '''<div class="range-analyzer">
  <h3>时段 AI 分析</h3>
  <p class="hint">选择日期范围，AI 将分析该时段的所有内容并生成总结报告</p>
  <div class="range-quick-btns">
    <button class="range-quick-btn" data-range="week" onclick="adrSetQuickRange('week')">本周</button>
    <button class="range-quick-btn" data-range="halfmonth" onclick="adrSetQuickRange('halfmonth')">半月</button>
    <button class="range-quick-btn" data-range="month" onclick="adrSetQuickRange('month')">本月</button>
    <button class="range-quick-btn" data-range="quarter" onclick="adrSetQuickRange('quarter')">本季度</button>
  </div>
  <div class="range-inputs">
    <label>从 <input type="date" id="range-start"></label>
    <label>到 <input type="date" id="range-end"></label>
    <button class="analyze-btn" id="range-analyze-btn" onclick="adrAnalyzeRange()">开始 AI 分析</button>
  </div>
  <div id="range-result"></div>
</div>'''

    # ── 日期导航区（PRD v2.2 §4.1）：置顶、默认最新一期、两行胶囊 ──
    issue_nav = (
        '<div class="issue-nav" id="issue-nav">'
        '<h3 class="group">日报期次</h3>'
        '<div class="date-bar">'
        '<button class="date-prev" id="date-prev" type="button" aria-label="上一期">‹</button>'
        '<label class="date-display" id="date-display">'
        '<span class="date-main" id="date-main">--</span>'
        '<span class="date-sub" id="date-sub">--</span>'
        '<select class="date-select" id="date-select" aria-label="选择日报日期"></select>'
        '</label>'
        '<button class="date-next" id="date-next" type="button" aria-label="下一期">›</button>'
        '</div>'
        '<div class="issue-live" id="issue-live" role="status" aria-live="polite"></div>'
        '</div>'
        '<script>window.__ADR_ISSUES=' + issue_index_json +
        ';window.__ADR_LATEST="' + esc(latest["date"]) + '";</script>'
    )

    # ── 期次内容容器：SSR 最新一期，切期时由 history.js 替换 ──
    issue_content = (
        '<div id="issue-content" data-date="' + esc(latest["date"]) + '">'
        + render_summary(latest, latest["date"])
        + latest_cards
        + '</div>'
    )

    # ── 底部翻页条（UI 评审 S2）：读完一期手指在底部，直接翻相邻期 ──
    issue_pager = (
        '<div class="issue-pager" id="issue-pager"></div>'
        '<div class="issue-footer">共 <span id="issue-total">' + str(len(reports)) +
        '</span> 期 · <a href="archive/' + esc(latest["date"]) + '.html">查看完整日报 →</a>'
        ' · <a href="digests/index.html">周期汇总（周/月/季）</a></div>'
    )

    index_body = (
        '<script>sessionStorage.setItem("adr_report","index.html")</script>'
        + fav_bar("")
        + action_bar("daily", True)
        + issue_nav
        + issue_content
        + issue_pager
        + range_analyzer
    )

    index = PAGE.format(
        title=latest["date"], css="style.css?v=" + CSS_VER, heading="AI 日报雷达",
        meta=f'数据抓取时间：{esc(latest["fetched_at"])} · 共 {len(latest["items"])} 条',
        mode="AI 深度解读" if latest.get("ai_enabled") else "原始榜单（未配置 API 密钥）",
        nav='<a href="digests/index.html">周期汇总（周/月/季）</a><a href="favorites.html">我的收藏夹</a>',
        favjs=f'<script src="fav-core.js?v={FAVJS_VER}"></script><script src="fav-index.js?v={FAVJS_VER}"></script><script src="back-to-top.js?v={FAVJS_VER}"></script>',
        pagetype="index",
        printjs="print.js",
        ogmeta=og_meta("AI 日报雷达 · 每日 AI 资讯与深度解读",
                       _top_desc(latest)),
        historyjs=f'<script src="history.js?v={BUILD_TS}"></script>',
        body=index_body)
    with open(os.path.join(DOCS, "index.html"), "w", encoding="utf-8") as fo:
        fo.write(index)
    return dates


def render_digest(d):
    url_by_title = {i.get("title"): i.get("url") for i in d["items"]}
    chips = (f'<span class="chip">{esc(d["start"])} ~ {esc(d["end"])}</span>'
             f'<span class="chip">{d["report_days"]} 期日报</span>'
             f'<span class="chip">{d["item_count"]} 条资讯（已去重）</span>'
             + "".join(f'<span class="chip">{esc(k)} {v}</span>'
                       for k, v in d["source_stats"].items()))
    parts = [f'<div class="stat-chips">{chips}</div>']

    a = d.get("analysis")
    if d.get("ai_enabled") and a:
        all_titles = list(url_by_title.keys())
        picks = "".join(
            _render_pick(p.get("title", ""), p.get("reason", ""),
                         _lookup_url(p.get("title", ""), url_by_title, all_titles))
            for p in a.get("top_picks", []))
        trends = "".join(f'<div class="trend">{esc(t)}</div>' for t in a.get("trends", []))
        parts.append(f"""<div class="card"><dl>
<dt>本期总览</dt><dd>{esc(a.get("overview"))}</dd>
<dt>本期趋势</dt><dd>{trends}</dd>
<dt>重点关注</dt><dd>{picks}</dd>
<dt>对我的行业有什么用？</dt><dd>{esc(a.get("industry_use"))}</dd>
<dt>风险提示</dt><dd>{esc(a.get("risks"))}</dd>
<dt>下期观察点</dt><dd>{esc(a.get("outlook"))}</dd>
</dl></div>""")
    else:
        parts.append('<div class="card"><p>本汇总为统计版（未配置 Kimi 密钥或调用失败），'
                     '只有条目清单，没有 AI 分析。</p></div>')

    lines = "".join(render_card(i, d.get("ai_enabled"), i.get("date", ""), variant="compact") for i in d["items"])
    parts.append(f"""<div class="card"><details>
<summary>查看本期全部 {d["item_count"]} 条资讯（按关注度排序）</summary>{lines}
</details></div>""")
    return "\n".join(parts)


def build_digests():
    os.makedirs(DIGESTS_OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(DIGESTS_DIR, "*.json")), reverse=True)

    groups = {}
    for f in files:
        d = json.load(open(f, encoding="utf-8"))
        groups.setdefault(d["type_cn"], []).append(d)
        page = PAGE.format(
            title=f'{d["type_cn"]} {d["label"]}', css="../style.css?v=" + CSS_VER,
            heading=f'{d["type_cn"]} · {esc(d["label"])}',
            meta=f'生成时间：{esc(d["generated_at"])}',
            mode="AI 趋势分析" if d.get("ai_enabled") else "统计版汇总",
            nav='<a href="../index.html">日报首页</a><a href="index.html">全部汇总</a><a href="../favorites.html">我的收藏夹</a>',
            favjs=f'<script src="../fav-core.js?v={FAVJS_VER}"></script>',
            pagetype="digest",
            printjs="",
            ogmeta="",
            historyjs="",
            body=render_digest(d))
        with open(os.path.join(DIGESTS_OUT, f"{d['label']}.html"), "w", encoding="utf-8") as fo:
            fo.write(page)

    body = ""
    for type_cn in ("周报", "月报", "季报", "自定义汇总"):
        if type_cn not in groups:
            continue
        links = "".join(f'<a href="{esc(d["label"])}.html">{esc(d["label"])}'
                        f'（{esc(d["start"])} ~ {esc(d["end"])}）</a>'
                        for d in groups[type_cn])
        body += f'<h3 class="group">{type_cn}</h3><div class="archive">{links}</div>'
    page = PAGE.format(
        title="周期汇总", css="../style.css?v=" + CSS_VER, heading="周期汇总",
        meta="周报每周一生成 · 月报每月 1 号生成 · 季报每季度首月 1 号生成",
        mode="周 / 月 / 季 / 自定义",
        nav='<a href="../index.html">日报首页</a><a href="../favorites.html">我的收藏夹</a>',
        favjs=f'<script src="../fav-core.js?v={FAVJS_VER}"></script>',
        pagetype="digest",
        printjs="",
        ogmeta="",
        historyjs="",
        body=body or '<div class="card"><p>还没有汇总。周报/月报/季报会按时间自动生成。</p></div>')
    with open(os.path.join(DIGESTS_OUT, "index.html"), "w", encoding="utf-8") as fo:
        fo.write(page)


def build_favorites():
    body = """<div class="card">
<!-- 「云端收藏」说明块已按用户要求取消。同步状态与导出按钮保留在隐藏容器中，
     仅为不打断 fav-core 的 JS 引用（updateSyncStatus / adrExport）。 -->
<div hidden aria-hidden="true">
  <span id="fav-sync-status" class="sync-status"></span>
  <button class="copy-btn" id="fav-copy" onclick="adrExport()">导出收藏为 JSON 备份</button>
</div>
<div class="fav-toolbar">
  <span class="fav-search-label">搜索</span>
  <input class="fav-search" id="fav-q" name="q" type="search" placeholder="输入关键词模糊查询（标题 / 简介 / 来源）" autocomplete="off" readonly>
  <button class="sort-btn" id="fav-sort" onclick="adrToggleSort()"></button>
</div>
<div class="fav-date-filter">
  <label>日期 <input type="date" id="fav-date" onchange="adrFilterDate()"></label>
  <label>从 <input type="date" id="fav-date-from" onchange="adrFilterDate()"></label>
  <label>到 <input type="date" id="fav-date-to" onchange="adrFilterDate()"></label>
  <button class="fav-date-reset" onclick="adrResetDate()">重置筛选</button>
</div>
<div class="tags" id="fav-count"></div>
<div id="fav-categories" style="margin:10px 0"></div>
</div>
<div id="fav-list"></div>"""
    page = PAGE.format(
        title="我的收藏夹", css="style.css?v=" + CSS_VER, heading="我的收藏夹",
        meta="登录后跨设备实时同步 · 邮箱 Magic Link 免密码",
        mode="收藏夹",
        nav='<a href="index.html" id="adr-home-link">日报首页</a><a href="digests/index.html">周期汇总（周/月/季）</a>',
        favjs=f'<script src="fav-core.js?v={FAVJS_VER}"></script><script src="fav-page.js?v={FAVJS_VER}"></script><script src="back-to-top.js?v={FAVJS_VER}"></script>',
        pagetype="favorites",
        printjs="print.js",
        ogmeta="",
        historyjs="",
        body=body + action_bar("favorites", False))
    with open(os.path.join(DOCS, "favorites.html"), "w", encoding="utf-8") as f:
        f.write(page)


def sync_items_to_supabase():
    """将 SQLite 中的 items 同步到 Supabase，供 Edge Function 查询"""
    import urllib.request

    SUPABASE_URL = "https://bvhzexdluniqdwmsxaxw.supabase.co"
    SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

    if not SUPABASE_KEY:
        print("Supabase sync skipped: SUPABASE_SERVICE_KEY not set")
        return

    from store import _connect
    conn = _connect()
    rows = conn.execute("SELECT * FROM items ORDER BY date DESC LIMIT 500").fetchall()
    conn.close()

    if not rows:
        print("Supabase sync: no items to sync")
        return

    items = [dict(r) for r in rows]
    print(f"Supabase sync: syncing {len(items)} items...")

    # Upsert items to Supabase
    url = f"{SUPABASE_URL}/rest/v1/items"
    data = json.dumps(items).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("apikey", SUPABASE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates")

    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print(f"Supabase sync: success (status {resp.status})")
    except Exception as e:
        print(f"Supabase sync failed: {e}")


def build_summaries():
    """生成 summaries.json，供收藏夹展示今日总结收藏的完整内容"""
    files = sorted(glob.glob(os.path.join(REPORTS_DIR, "*.json")), reverse=True)
    summaries = {}
    for f in files:
        rep = json.load(open(f, encoding="utf-8"))
        s = rep.get("summary")
        if not s:
            continue
        summaries[rep["date"]] = {
            "overview": s.get("overview", ""),
            "conclusions": s.get("conclusions", []),
            "top_picks": [{"title": p.get("title", ""), "reason": p.get("reason", "")}
                          for p in s.get("top_picks", [])],
            "industry_use": s.get("industry_use", ""),
            "risks": s.get("risks", "")
        }
    with open(os.path.join(DOCS, "summaries.json"), "w", encoding="utf-8") as f:
        json.dump(summaries, f, ensure_ascii=False, indent=2)
    print(f"summaries.json: {len(summaries)} summaries")


def main():
    dates = build_daily()
    build_digests()
    build_favorites()
    build_summaries()
    # docs/fav.js 直接维护，不再从常量写入
    # 复制 style.css 到 docs/
    css_src = os.path.join(os.path.dirname(__file__), "style.css")
    if os.path.exists(css_src):
        with open(css_src, encoding="utf-8") as src:
            with open(os.path.join(DOCS, "style.css"), "w", encoding="utf-8") as dst:
                dst.write(src.read())

    # 复制 print.js 到 docs/（打印 / 复制链接）
    print_src = os.path.join(os.path.dirname(__file__), "print.js")
    if os.path.exists(print_src):
        with open(print_src, "r", encoding="utf-8") as src:
            with open(os.path.join(DOCS, "print.js"), "w", encoding="utf-8") as dst:
                dst.write(src.read())
    # 清理 90 天前的 SQLite 历史数据
    cleanup_old(days=90)
    # 同步数据到 Supabase
    sync_items_to_supabase()
    from store import stats as db_stats
    db_info = db_stats()
    print(f"OK: 日报 {len(dates)} 期, 汇总 {len(glob.glob(os.path.join(DIGESTS_DIR, '*.json')))} 期, "
          f"收藏夹页已生成, SQLite 共 {db_info['total']} 条记录")


if __name__ == "__main__":
    main()

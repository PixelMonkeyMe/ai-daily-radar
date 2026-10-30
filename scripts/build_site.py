"""读取 data/reports/*.json 和 data/digests/*.json，生成 docs/ 下的静态网页（GitHub Pages 发布源）"""
import glob
import html
import json
import os
import sys
from datetime import datetime, timezone, timedelta

# 确保 data/ 目录下的模块可导入
DATA_DIR = os.path.join(BASE := os.path.join(os.path.dirname(__file__), ".."), "data")
if DATA_DIR not in sys.path:
    sys.path.insert(0, DATA_DIR)

from story_grouping import group_stories
from store import insert_items, find_previous_dates, get_top_historical, cleanup_old

REPORTS_DIR = os.path.join(BASE, "data", "reports")
DIGESTS_DIR = os.path.join(BASE, "data", "digests")
DOCS = os.path.join(BASE, "docs")
ARCHIVE = os.path.join(DOCS, "archive")
DIGESTS_OUT = os.path.join(DOCS, "digests")

STARS = {1: "★☆☆☆☆", 2: "★★☆☆☆", 3: "★★★☆☆", 4: "★★★★☆", 5: "★★★★★"}

CSS = """
  * { box-sizing: border-box; margin: 0; }
  body { background: #f4f5f7; color: #1f2329; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.7; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 24px 16px 60px; background: #fff; }
  header.top { background: linear-gradient(135deg, #0f2027, #203a43, #2c5364); color: #fff; padding: 36px 16px 30px; }
  .top-inner { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 26px; letter-spacing: 1px; }
  .meta { color: rgba(255,255,255,.75); font-size: 13px; margin-top: 8px; }
  .badge { display: inline-block; background: rgba(255,255,255,.15); border-radius: 99px; padding: 2px 12px; font-size: 12px; margin-top: 10px; }
  .nav { margin-top: 14px; font-size: 13px; }
  .nav a { color: #cfe3ff; text-decoration: none; margin-right: 18px; border-bottom: 1px dashed rgba(255,255,255,.4); }
  .card { background: #fff; border-radius: 14px; padding: 22px 22px 16px; margin: 18px 0; box-shadow: 0 1px 4px rgba(0,0,0,.05); }
  .card h2 { font-size: 18px; line-height: 1.4; }
  .card h2 a { color: #1f2329; text-decoration: none; }
  .card h2 a:hover { color: #1677ff; }
  .tags { margin: 8px 0 4px; font-size: 12px; color: #8a919c; }
  .tag-src { background: #eef3ff; color: #1677ff; border-radius: 6px; padding: 1px 8px; margin-right: 8px; }
  .tag-star { color: #f5a623; letter-spacing: 2px; }
  .similar { font-size: 12px; color: #8a919c; margin-top: 4px; }
  .similar b { color: #1677ff; font-weight: 600; }
  .story-group { background: #fff; border-radius: 14px; padding: 18px 22px; margin: 18px 0; box-shadow: 0 1px 4px rgba(0,0,0,.05); border-left: 4px solid #1677ff; }
  .story-group-header { font-size: 12px; color: #1677ff; font-weight: 600; margin-bottom: 10px; }
  .story-group .card { margin: 10px 0; box-shadow: none; border: 1px solid #e5e8ec; }
  .story-group .card:first-of-type { margin-top: 0; }
  .top5-badge { display: inline-block; background: #fff0f0; color: #e63946; border-radius: 6px; padding: 0 8px; font-size: 12px; margin-left: 8px; font-weight: 600; }
  dl { margin-top: 10px; }
  dt { font-weight: 700; font-size: 14px; color: #203a43; margin-top: 12px; padding-left: 10px; border-left: 3px solid #2c5364; }
  dd { font-size: 14.5px; color: #3c434c; margin: 4px 0 0 13px; }
  .archive { font-size: 14px; margin-top: 26px; }
  .archive a { color: #1677ff; text-decoration: none; margin-right: 14px; display: inline-block; margin-bottom: 6px; }
  .raw p { font-size: 14.5px; color: #3c434c; margin-top: 8px; }
  .stat-chips { margin-top: 12px; }
  .chip { display: inline-block; background: #fff; border: 1px solid #e5e8ec; border-radius: 99px; padding: 3px 14px; font-size: 13px; color: #3c434c; margin: 0 8px 8px 0; }
  .trend { background: #f0f7ff; border-radius: 10px; padding: 10px 14px; margin: 8px 0; font-size: 14.5px; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: #1677ff; font-size: 14px; }
  .item-line { font-size: 13.5px; margin: 6px 0; }
  .item-line a { color: #1f2329; text-decoration: none; }
  .item-line a:hover { color: #1677ff; }
  .brief { font-size: 14.5px; color: #3c434c; margin-top: 8px; }
  .summary-card { border: 2px solid #2c5364; background: linear-gradient(180deg, #f7fbfc, #ffffff); }
  .summary-title { font-size: 20px; color: #203a43; }
  h3.group { margin: 22px 0 6px; font-size: 16px; color: #203a43; }
  footer { text-align: center; color: #a0a6ad; font-size: 12px; margin-top: 40px; }
  .fav-btn { background: none; border: none; cursor: pointer; font-size: 16px; color: #c8ccd2; vertical-align: middle; margin-left: 6px; padding: 0 2px; }
  .fav-btn.on { color: #f5a623; }
  .fav-link-box { background: #f0f7ff; border: 1px dashed #1677ff; border-radius: 10px; padding: 12px 14px; margin: 14px 0; font-size: 13px; word-break: break-all; }
  .fav-link-box .lnk { color: #1677ff; }
  .copy-btn { display: inline-block; margin-top: 8px; background: #1677ff; color: #fff; border: none; border-radius: 8px; padding: 6px 16px; font-size: 13px; cursor: pointer; }
  .fav-toolbar { margin: 14px 0; display: flex; gap: 10px; flex-wrap: wrap; }
  .fav-search { flex: 1; min-width: 200px; max-width: 420px; padding: 8px 12px; border: 1px solid #d9dde3; border-radius: 8px; font-size: 14px; }
  .fav-search-label { font-size: 14px; color: #3c434c; font-weight: 600; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
  .sort-btn { padding: 8px 14px; border: 1px solid #d9dde3; background: #fff; border-radius: 8px; font-size: 13px; cursor: pointer; }
  .fav-date-filter { margin: 10px 0; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; color: #3c434c; }
  .fav-date-filter label { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .fav-date-filter input[type="date"] { padding: 6px 10px; border: 1px solid #d9dde3; border-radius: 8px; font-size: 13px; color: #1f2329; }
  .fav-date-reset { padding: 6px 14px; border: 1px solid #d9dde3; background: #fff; border-radius: 8px; font-size: 13px; cursor: pointer; color: #8a919c; }
  .fav-date-reset:hover { background: #f4f5f7; }
  .fav-bar { margin-top: 16px; }
  .fav-bar a { display: block; background: #fff7e8; border: 1px solid #f5c26b; border-radius: 12px; padding: 12px 16px; color: #8a5a00; text-decoration: none; font-size: 14.5px; }
  .fav-bar a:hover { background: #ffefc9; }
  .fav-chip { display: inline-block; background: #f5a623; color: #fff; border-radius: 99px; padding: 0 10px; font-size: 13px; margin: 0 4px; }
  .history-day { padding: 8px 0 12px; }
  .history-day .item-line { padding: 4px 0; border-bottom: 1px dashed #e5e8ec; }
  .history-day .item-line:last-child { border-bottom: none; }
  .history-date { font-weight: 600; color: #203a43; }
  .already-fav { display: inline-block; background: #fff7e8; color: #8a5a00; border-radius: 6px; padding: 0 8px; font-size: 12px; margin-left: 6px; font-weight: 600; }
  .export-pdf-btn { display: inline-block; background: #e63946; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; cursor: pointer; margin: 10px 0; font-weight: 600; }
  .export-pdf-btn:hover { background: #c1121f; }
  .export-pdf-btn:disabled { background: #ccc; cursor: not-allowed; }
  .pdf-loading { display: none; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 10px 16px; margin: 10px 0; font-size: 14px; color: #856404; }
  /* ── 登录弹窗 ── */
  .adr-modal-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.45); z-index:9999; justify-content:center; align-items:center; }
  .adr-modal { background:#fff; border-radius:16px; padding:32px 28px 24px; max-width:400px; width:90%; box-shadow:0 8px 30px rgba(0,0,0,.15); text-align:center; }
  .adr-modal h3 { font-size:20px; color:#203a43; margin-bottom:8px; }
  .adr-modal p { font-size:14px; color:#8a919c; margin-bottom:18px; }
  .adr-modal input[type="email"], .adr-modal input[type="password"] { width:100%; padding:10px 14px; border:1px solid #d9dde3; border-radius:10px; font-size:15px; margin-bottom:12px; box-sizing:border-box; }
  .adr-modal input[type="email"]:focus, .adr-modal input[type="password"]:focus { outline:none; border-color:#1677ff; }
  .adr-auth-tabs { display:flex; gap:0; margin-bottom:16px; border-bottom:2px solid #e5e8ec; }
  .adr-auth-tab { flex:1; padding:10px 0; text-align:center; font-size:14px; color:#8a919c; cursor:pointer; background:none; border:none; border-bottom:2px solid transparent; margin-bottom:-2px; transition:all .15s; }
  .adr-auth-tab.active { color:#1677ff; border-bottom-color:#1677ff; font-weight:600; }
  .adr-forgot-link { display:inline-block; margin-top:8px; font-size:13px; color:#1677ff; cursor:pointer; background:none; border:none; padding:0; }
  .adr-modal-btn { width:100%; padding:10px; background:#1677ff; color:#fff; border:none; border-radius:10px; font-size:15px; cursor:pointer; font-weight:600; }
  .adr-modal-btn:hover { background:#0e5fcc; }
  .adr-modal-btn:disabled { background:#ccc; cursor:not-allowed; }
  .adr-modal-close { position:absolute; top:12px; right:16px; background:none; border:none; font-size:22px; color:#8a919c; cursor:pointer; }
  .adr-modal-msg { font-size:13px; color:#e63946; margin-top:10px; min-height:20px; }
  .adr-nav-auth { margin-left:auto; display:flex; align-items:center; gap:8px; font-size:13px; }
  .adr-nav-auth .adr-login-btn { color:#cfe3ff; border-bottom:1px dashed rgba(255,255,255,.4); cursor:pointer; background:none; border-top:none; border-left:none; border-right:none; font-size:13px; }
  .adr-nav-auth .adr-logout-btn { color:#cfe3ff; border-bottom:1px dashed rgba(255,255,255,.4); cursor:pointer; background:none; border-top:none; border-left:none; border-right:none; font-size:13px; display:none; }
  .adr-nav-auth .adr-user-email { color:rgba(255,255,255,.7); font-size:12px; display:none; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* ── 时段分析 ── */
  .range-analyzer { background: linear-gradient(135deg, #f0f7ff, #e8f4ff); border: 1px solid #b3d7ff; border-radius: 14px; padding: 20px 24px; margin: 20px 0; }
  .range-analyzer h3 { font-size: 16px; color: #203a43; margin-bottom: 12px; }
  .range-analyzer .range-inputs { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .range-analyzer input[type="date"] { padding: 8px 12px; border: 1px solid #d9dde3; border-radius: 8px; font-size: 14px; color: #1f2329; }
  .range-analyzer .analyze-btn { padding: 8px 20px; background: #1677ff; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
  .range-analyzer .analyze-btn:hover { background: #0e5fcc; }
  .range-analyzer .analyze-btn:disabled { background: #ccc; cursor: not-allowed; }
  .range-analyzer #range-result { margin-top: 16px; }
  .range-quick-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .range-quick-btn { padding: 6px 14px; background: #fff; border: 1px solid #b3d7ff; border-radius: 16px; font-size: 13px; color: #1677ff; cursor: pointer; transition: all .15s; }
  .range-quick-btn:hover { background: #e8f4ff; }
  .range-quick-btn.active { background: #1677ff; color: #fff; border-color: #1677ff; }
  .range-quick-btn:disabled { opacity: .5; cursor: not-allowed; }
  @media print {
    .export-pdf-btn, .pdf-loading, .fav-btn, .fav-bar, .nav, header.top .badge { display: none !important; }
    body { background: #fff; }
    .wrap { max-width: 100%; padding: 0; }
    .card { box-shadow: none; border: 1px solid #ddd; page-break-inside: avoid; }
  }
  /* ── 响应式布局（仅屏幕设备，打印/PDF 导出时不生效） ── */
  @media screen and (max-width: 768px) {
    .wrap { padding: 16px 12px 40px; }
    .top-inner { padding: 0 4px; }
    h1 { font-size: 22px; }
    .nav { flex-wrap: wrap; gap: 6px; }
    .nav a { margin-right: 10px; font-size: 13px; white-space: nowrap; }
    .card { padding: 16px 16px 12px; margin: 12px 0; }
    .card h2 { font-size: 16px; }
    .story-group { padding: 14px 16px; }
    .fav-bar a { font-size: 13.5px; padding: 10px 12px; }
    .fav-search { min-width: 140px; max-width: 280px; font-size: 13px; }
    .fav-date-filter { font-size: 12px; }
    .range-analyzer { padding: 14px 16px; }
    .adr-modal { padding: 24px 20px 18px; }
    .adr-modal h3 { font-size: 18px; }
  }
  @media screen and (max-width: 480px) {
    header.top { padding: 24px 12px 20px; }
    h1 { font-size: 19px; }
    .meta { font-size: 12px; }
    .badge { font-size: 11px; padding: 2px 8px; }
    .nav a { font-size: 12px; margin-right: 8px; }
    .adr-nav-auth { font-size: 12px; }
    .card { padding: 12px 12px 10px; margin: 10px 0; border-radius: 10px; }
    .card h2 { font-size: 15px; }
    .brief, dt, dd, .trend, .item-line { font-size: 13px !important; }
    .fav-btn { font-size: 14px; }
    .fav-bar a { font-size: 12.5px; padding: 8px 10px; }
    .fav-chip { font-size: 11px; padding: 0 7px; }
    .archive a { font-size: 13px; margin-right: 10px; }
    .adr-modal { width: 96%; padding: 20px 16px 14px; }
    .summary-title { font-size: 17px !important; }
    .export-pdf-btn { font-size: 13px; padding: 6px 14px; }
  }
"""

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 日报雷达 · {title}</title>
<style>{css}</style>
</head>
<body>
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
    <h3>🔑 登录</h3>
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
        <div style="margin-top:8px;font-size:13px"><a href="#" onclick="adrResendCode();return false" style="color:#1677ff">没收到？重新发送</a></div>
      </div>
    </div>
    <div id="adr-forgot-section" style="display:none">
      <p style="font-size:13px;color:#8a919c;margin-bottom:12px">输入邮箱，我们将发送密码重置链接</p>
      <input type="email" id="adr-forgot-email" placeholder="your@email.com" onkeydown="if(event.key==='Enter')adrSendPasswordReset()">
      <button class="adr-modal-btn" id="adr-forgot-btn" onclick="adrSendPasswordReset()">发送重置链接</button>
      <button class="adr-forgot-link" onclick="adrBackToLogin()" style="margin-top:12px">← 返回登录</button>
    </div>
    <div class="adr-modal-msg" id="adr-login-msg"></div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="{favjs}"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="{pdfjs}"></script>
</body>
</html>"""




def esc(s):
    return html.escape(str(s or ""))


def _jaccard(a, b):
    """基于字符 bigram 的 Jaccard 相似度，用于判断标题是否类似。"""
    a, b = str(a).lower(), str(b).lower()
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa = set(a[i:i + 2] for i in range(len(a) - 1))
    sb = set(b[i:i + 2] for i in range(len(b) - 1))
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def find_similar_dates(title, url, all_reports, current_date, threshold=0.65):
    """
    返回该条目在其它日期出现过的日期列表（按时间倒序，最多 3 个）。
    判断规则：URL 完全一致，或标题 Jaccard 相似度 >= threshold。
    """
    matches = set()
    for rep in all_reports:
        if rep["date"] == current_date:
            continue
        for item in rep["items"]:
            if item.get("url") == url:
                matches.add(rep["date"])
                break
            if _jaccard(item.get("title", ""), title) >= threshold:
                matches.add(rep["date"])
                break
    return sorted(matches, reverse=True)[:3]


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


def render_summary(rep, date=""):
    s = rep.get("summary")
    if not s:
        return ""
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
<h2 class="summary-title">今日总结 · AI 主编解读{summary_btn}</h2>
<dl>
<dt>今日总览</dt><dd>{esc(s.get("overview"))}</dd>
<dt>核心结论</dt><dd>{conclusions}</dd>
<dt>今日重点关注</dt><dd>{picks}</dd>
<dt>对我的行业有什么用？</dt><dd>{esc(s.get("industry_use"))}</dd>
<dt>风险提示</dt><dd>{esc(s.get("risks"))}</dd>
</dl></div>"""


def similar_badge(dates):
    if not dates:
        return ""
    date_links = "、".join(f"<b>{esc(d)}</b>" for d in dates)
    return f'<div class="similar">📌 此前曾在 {date_links} 出现</div>'


def fav_btn(i, date, brief):
    return (f'<button class="fav-btn" title="收藏" '
            f'data-t="{esc(i.get("title"))}" data-u="{esc(i.get("url"))}" '
            f'data-s="{esc(i.get("source"))}" data-d="{esc(date)}" '
            f'data-b="{esc(brief)}">☆</button>')


def render_card(i, ai, date="", similar_dates=None, top5=False):
    similar_dates = similar_dates or []
    title = esc(i.get("title"))
    url = esc(i.get("url"))
    src = esc(i.get("source"))
    extra = esc(i.get("extra", ""))
    star = ""
    if ai and i.get("importance"):
        star = f'<span class="tag-star">{STARS.get(int(i["importance"]), "")}</span>'
    brief = i.get("brief") or i.get("what") or i.get("description") or ""
    top5_tag = '<span class="top5-badge">历史补全</span>' if top5 else ''
    head = (f'<h2><a href="{url}" target="_blank" rel="noopener">{title}</a>'
            f'{fav_btn(i, date, brief)}{top5_tag}</h2>'
            f'<div class="tags"><span class="tag-src">{src}</span>{star} {extra}</div>'
            f'{similar_badge(similar_dates)}')
    if not ai:
        return f'<div class="card raw">{head}<p>{esc(i.get("description"))}</p></div>'
    fields = [("这是什么？", "what"), ("对我的行业有什么用？", "industry_use"),
              ("这能干什么？", "capability"), ("评估与判断", "assessment"),
              ("风险与应用场景", "risk")]
    detail = "".join(f'<dt>{label}</dt><dd>{esc(i.get(key))}</dd>'
                     for label, key in fields if i.get(key))
    return (f"<div class='card'>{head}"
            f'<p class="brief">{esc(brief)}</p>'
            f'<details><summary>展开完整分析</summary><dl>{detail}</dl></details></div>')


def render_story_group(story, ai, date="", similar_dates_map=None):
    """渲染一个故事组（多源报道同一事件）"""
    similar_dates_map = similar_dates_map or {}
    if len(story["items"]) <= 1:
        return render_card(story["items"][0], ai, date,
                           similar_dates_map.get(story["items"][0].get("url")))
    # 多条目 Story
    header = (f'<div class="story-group-header">'
              f'📰 {story["source_count"]} 个来源报道了同一事件</div>')
    cards = "\n".join(
        render_card(item, ai, date,
                    similar_dates_map.get(item.get("url")))
        for item in story["items"]
    )
    return f'<div class="story-group">{header}{cards}</div>'


def item_line(i, ai, date="", similar_dates=None):
    similar_dates = similar_dates or []
    star = f' <span class="tag-star">{STARS.get(int(i["importance"]), "")}</span>' \
        if ai and i.get("importance") else ""
    brief = i.get("brief") or i.get("what") or ""
    sim = similar_badge(similar_dates)
    return (f'<div class="item-line"><span class="tag-src">{esc(i.get("source"))}</span>'
            f'<a href="{esc(i.get("url"))}" target="_blank" rel="noopener">{esc(i.get("title"))}</a>{star}'
            f'{fav_btn(i, date, brief)}</div>{sim}')


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
            title=rep["date"], css=CSS, heading="AI 日报雷达",
            meta=f'数据抓取时间：{esc(rep["fetched_at"])} · 共 {len(rep["items"])} 条',
            mode="AI 深度解读" if rep.get("ai_enabled") else "原始榜单（未配置 API 密钥）",
            nav='<a href="../index.html">最新日报</a><a href="../digests/index.html">周期汇总（周/月/季）</a><a href="../favorites.html">我的收藏夹</a>',
            favjs="../fav.js?v=3.3b",
            pdfjs="../export_pdf.js",
            body=f'<script>sessionStorage.setItem("adr_report","archive/{rep["date"]}.html")</script>'
                 + fav_bar("../") + render_summary(rep, rep["date"]) + cards + f'<div class="archive"><b>历史日报：</b>{links}</div>')
        with open(os.path.join(ARCHIVE, f"{rep['date']}.html"), "w", encoding="utf-8") as fo:
            fo.write(page)

    # 生成 index.html：当日完整展示（含故事分组 + Top 5 补全） + 历史折叠
    latest_cards = render_items_for_index()

    # 历史折叠面板：每个日期一个 <details>，内部是 item_line 精简列表
    history_parts = []
    for rep in reports[1:]:
        lines = "\n".join(
            item_line(i, rep.get("ai_enabled"), rep["date"], i.get("_similar_dates", []))
            for i in rep["items"]
        )
        history_parts.append(
            f'<details>'
            f'<summary><span class="history-date">{esc(rep["date"])}</span> '
            f'（共 {len(rep["items"])} 条）· 点击展开</summary>'
            f'<div class="history-day">{lines}</div>'
            f'<div style="margin-top:8px;font-size:13px;">'
            f'<a href="archive/{esc(rep["date"])}.html">查看完整日报 →</a></div>'
            f'</details>'
        )

    if history_parts:
        history_section = (
            '<h3 class="group">历史日报</h3>'
            + "".join(history_parts)
        )
        archive_div = f'<div class="archive">{history_section}</div>'
    else:
        archive_div = ""

    # 时段分析器 HTML
    range_analyzer = '''<div class="range-analyzer">
  <h3>📊 时段 AI 分析</h3>
  <p style="font-size:13px;color:#8a919c;margin-bottom:12px">选择日期范围，AI 将分析该时段的所有内容并生成总结报告</p>
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

    index_body = (
        '<script>sessionStorage.setItem("adr_report","index.html")</script>'
        + fav_bar("")
        + '<div><button class="export-pdf-btn" onclick="exportDailyPDF()">📄 导出当日日报为 PDF</button>'
        + '<div class="pdf-loading" id="pdf-loading">⏳ 正在生成 PDF，请稍候...</div></div>'
        + range_analyzer
        + render_summary(latest, latest["date"])
        + latest_cards
        + archive_div
    )

    index = PAGE.format(
        title=latest["date"], css=CSS, heading="AI 日报雷达",
        meta=f'数据抓取时间：{esc(latest["fetched_at"])} · 共 {len(latest["items"])} 条',
        mode="AI 深度解读" if latest.get("ai_enabled") else "原始榜单（未配置 API 密钥）",
        nav='<a href="digests/index.html">周期汇总（周/月/季）</a><a href="favorites.html">我的收藏夹</a>',
        favjs="fav.js?v=3.3b",
        pdfjs="export_pdf.js",
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

    lines = "".join(item_line(i, d.get("ai_enabled"), i.get("date", "")) for i in d["items"])
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
            title=f'{d["type_cn"]} {d["label"]}', css=CSS,
            heading=f'{d["type_cn"]} · {esc(d["label"])}',
            meta=f'生成时间：{esc(d["generated_at"])}',
            mode="AI 趋势分析" if d.get("ai_enabled") else "统计版汇总",
            nav='<a href="../index.html">日报首页</a><a href="index.html">全部汇总</a><a href="../favorites.html">我的收藏夹</a>',
            favjs="../fav.js?v=3.3b",
            pdfjs="../export_pdf.js",
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
        title="周期汇总", css=CSS, heading="周期汇总",
        meta="周报每周一生成 · 月报每月 1 号生成 · 季报每季度首月 1 号生成",
        mode="周 / 月 / 季 / 自定义",
        nav='<a href="../index.html">日报首页</a><a href="../favorites.html">我的收藏夹</a>',
        favjs="../fav.js?v=3.3b",
        pdfjs="../export_pdf.js",
        body=body or '<div class="card"><p>还没有汇总。周报/月报/季报会按时间自动生成。</p></div>')
    with open(os.path.join(DIGESTS_OUT, "index.html"), "w", encoding="utf-8") as fo:
        fo.write(page)


def build_favorites():
    body = """<div class="card">
<h2>☁️ 云端收藏</h2>
<div class="fav-link-box">
  收藏自动保存到云端数据库，登录后任何设备（手机/电脑/平板）打开本网站即可查看。
  数据实时同步，换设备登录同一邮箱即可看到全部收藏。<br>
  <span id="fav-sync-status" style="color:#1677ff;font-weight:600"></span><br>
  <button class="copy-btn" id="fav-copy" onclick="adrExport()">📥 导出收藏为 JSON 备份</button>
</div>
<div class="fav-toolbar">
  <span class="fav-search-label">🔍 搜索</span>
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
        title="我的收藏夹", css=CSS, heading="我的收藏夹",
        meta="登录后跨设备实时同步 · 邮箱 Magic Link 免密码",
        mode="收藏夹",
        nav='<a href="index.html" id="adr-home-link">日报首页</a><a href="digests/index.html">周期汇总（周/月/季）</a>',
        favjs="fav.js?v=3.3b",
        pdfjs="export_pdf.js",
        body=body + '<div><button class="export-pdf-btn" onclick="exportFavoritesPDF()">📄 导出收藏夹为 PDF</button>'
              + '<div class="pdf-loading" id="pdf-loading">⏳ 正在生成 PDF，请稍候...</div></div>')
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
    # 复制 export_pdf.js 到 docs/
    export_pdf_src = os.path.join(os.path.dirname(__file__), "export_pdf.js")
    if os.path.exists(export_pdf_src):
        with open(export_pdf_src, "r", encoding="utf-8") as src:
            with open(os.path.join(DOCS, "export_pdf.js"), "w", encoding="utf-8") as dst:
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

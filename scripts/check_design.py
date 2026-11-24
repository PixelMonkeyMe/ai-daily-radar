#!/usr/bin/env python3
"""视觉结构断言 —— 让「漂移」不可能，而不是靠事后检测。

用法：python scripts/check_design.py   （由 test.sh 调用）
退出码 0 通过 / 1 有失败项
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

TOKENS = {"#fff", "#141414", "#3a3a3a", "#1f1f1f", "#8b8b8b", "#e8e8e8", "#cfcfcf", "#b3261e"}
RADII = {"0", "2px", "4px", "50%"}
COLOR_EMOJI = re.compile(r"[\U0001F300-\U0001FAFF\u2700-\u27BF]")

HOOKS = {
    "index.html": ["class=\"card", "id=\"issue-content", "issue-nav", "date-prev", "date-next",
                   "date-select", "issue-pager", "issue-live", "share-bar", "copy-link-btn",
                   "back-to-top", "range-analyzer", "range-result", "analyze-btn", "fav-btn"],
    "favorites.html": ["id=\"fav-list", "share-bar", "back-to-top"],
}
GLOBAL_HOOKS = []

results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("  " + detail if detail else ""))


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


# ── 1. DOM 钩子白名单 ──
for page, hooks in HOOKS.items():
    path = os.path.join(DOCS, page)
    if not os.path.exists(path):
        check("1 DOM 钩子 · " + page, False, "文件不存在")
        continue
    html = read(path)
    missing = [h for h in hooks if h not in html] + [h for h in GLOBAL_HOOKS if h not in html]
    check("1 DOM 钩子 · " + page, not missing, ("缺: " + ", ".join(missing[:5])) if missing else "")

arch = os.path.join(DOCS, "archive")
if os.path.isdir(arch):
    sample = sorted(f for f in os.listdir(arch) if f.endswith(".html"))
    if sample:
        html = read(os.path.join(arch, sample[-1]))
        need = ["class=\"card", "share-bar", "details"]
        miss = [h for h in need if h not in html]
        check("1 DOM 钩子 · archive/" + sample[-1], not miss, ("缺: " + ", ".join(miss)) if miss else "")

# ── 2. 色值白名单 ──
css_path = os.path.join(DOCS, "style.css")
css = read(css_path) if os.path.exists(css_path) else ""
bad_colors = sorted({c.lower() for c in re.findall(r"#[0-9a-fA-F]{3,8}", css)} - TOKENS)
check("2 色值白名单 · style.css", not bad_colors, ("越界: " + ", ".join(bad_colors[:5])) if bad_colors else "")

html_bad = []
for f in os.listdir(DOCS):
    if f.endswith(".html"):
        hits = {c.lower() for c in re.findall(r"#[0-9a-fA-F]{6}", read(os.path.join(DOCS, f)))} - TOKENS
        if hits:
            html_bad.append(f + ":" + ",".join(list(hits)[:2]))
check("2 色值白名单 · *.html", not html_bad, ("越界: " + "; ".join(html_bad[:3])) if html_bad else "")

# ── 3. 圆角白名单 ──
radii = {r.strip() for r in re.findall(r"border-radius:\s*([^;]+);", css)}
radii = {r for r in radii if not r.startswith("var(")}
bad_r = sorted(radii - RADII)
check("3 圆角白名单", not bad_r, ("越界: " + ", ".join(bad_r)) if bad_r else "")

# ── 4. 唯一卡片产出 ──
bs = read(os.path.join(ROOT, "scripts", "build_site.py"))
dup = re.findall(r"^def (item_line|render_line|card_compact)\(", bs, re.M)
check("4 唯一卡片产出函数", not dup, ("仍有: " + ", ".join(dup)) if dup else "")

# ── 5. 无彩色 emoji ──
emo_files = [f for f in os.listdir(DOCS) if f.endswith((".html", ".js"))]
emo_bad = {}
for f in emo_files:
    hits = COLOR_EMOJI.findall(read(os.path.join(DOCS, f)))
    if hits:
        emo_bad[f] = sorted(set(hits))[:4]
check("5 无彩色 emoji（HTML+JS）", not emo_bad,
      ("发现: " + "; ".join(k + ":" + "".join(v) for k, v in list(emo_bad.items())[:3])) if emo_bad else "")

# ── 6. JS 里不得写死色值（防「JS 绕过设计系统」）──
js_hex = {}
for f in os.listdir(DOCS):
    if f.endswith(".js"):
        hits = {c.lower() for c in re.findall(r"#[0-9a-fA-F]{6}", read(os.path.join(DOCS, f)))} - TOKENS
        if hits:
            js_hex[f] = sorted(hits)[:4]
check("6 JS 无写死色值", not js_hex,
      ("发现: " + "; ".join(k + ":" + ",".join(v) for k, v in list(js_hex.items())[:3])) if js_hex else "")

failed = [n for n, ok in results if not ok]
print("\n结果：%d/%d 通过%s" % (len(results) - len(failed), len(results),
                              ("，失败：" + ", ".join(failed)) if failed else ""))
sys.exit(1 if failed else 0)

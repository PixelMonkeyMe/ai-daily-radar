// 打印 / 分享 —— 替代自研 PDF 导出（2026-11-19）
//
// 背景：旧方案 html2canvas + jsPDF 把整页渲成一张 31.9M 像素的图，
// 再把同一张图重复塞进 12 页 A4，产出 264.8MB、零超链接、文字不可选的 PDF。
// 现改为交给浏览器打印引擎：实测 472KB / 9 页 / 100 个可点链接 / 文字可选。
//
// 本文件负责三件事：
//   1. 打印前展开全部 <details>（否则 38 个 AI 分析折叠区在打印产物里会整块丢失）
//   2. 收藏页打印前注入「今日总结」全文（summaries.json）
//   3. 「复制链接」——分享落点是 SSR 的 archive/<date>.html

/* ── 折叠区：打印前展开，打印后还原原状态 ── */
function _expandAllDetails() {
  var saved = [];
  var ds = document.querySelectorAll("details");
  for (var i = 0; i < ds.length; i++) {
    saved.push({ el: ds[i], wasOpen: ds[i].hasAttribute("open") });
    ds[i].setAttribute("open", "");
  }
  return saved;
}

function _restoreAllDetails(saved) {
  if (!saved) return;
  for (var i = 0; i < saved.length; i++) {
    if (!saved[i].wasOpen) saved[i].el.removeAttribute("open");
  }
}

/* ── 今日总结：按需抓取 summaries.json 并缓存 ── */
var _summaryCache = null;

function _docsPrefix() {
  return window.location.pathname.indexOf("/archive/") >= 0 ? "../" : "";
}

function _loadSummaries() {
  if (_summaryCache) return Promise.resolve(_summaryCache);
  return fetch(_docsPrefix() + "summaries.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      _summaryCache = data;
      return data;
    });
}

/* 用 DOM 构建，不用 innerHTML —— summaries.json 是 LLM 输出，历史上出过未转义事故 */
function _buildSummaryBlock(summary) {
  var box = document.createElement("div");
  box.className = "summary-full-content";

  var picks = summary.top_picks;
  if (Array.isArray(picks)) {
    picks = picks.map(function (p) { return p && p.title ? p.title : p; }).join("、");
  }
  var concl = summary.conclusions;
  if (Array.isArray(concl)) concl = concl.join("; ");

  var rows = [
    ["概述", summary.overview],
    ["结论", concl],
    ["精选", picks],
    ["行业应用", summary.industry_use],
    ["风险", summary.risks]
  ];

  for (var i = 0; i < rows.length; i++) {
    var val = rows[i][1];
    if (!val) continue;
    var p = document.createElement("p");
    var b = document.createElement("b");
    b.textContent = rows[i][0] + ": ";
    p.appendChild(b);
    p.appendChild(document.createTextNode(String(val)));
    box.appendChild(p);
  }
  return box;
}

/* 同步注入：Ctrl+P 路径也能在 beforeprint 内完成 */
function _injectSummarySync(data) {
  var cards = document.querySelectorAll("#fav-list .card");
  for (var i = 0; i < cards.length; i++) {
    var title = cards[i].querySelector("h2");
    if (!title) continue;
    var t = title.textContent || "";
    if (t.indexOf("今日总结") === -1) continue;

    var m = t.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m || !data[m[1]]) continue;

    var old = cards[i].querySelector(".summary-full-content");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var block = _buildSummaryBlock(data[m[1]]);
    var brief = cards[i].querySelector(".brief");
    if (brief && brief.parentNode) brief.parentNode.insertBefore(block, brief.nextSibling);
    else cards[i].appendChild(block);
  }
}

function _injectSummaryContent() {
  return _loadSummaries().then(function (data) {
    _injectSummarySync(data);
    return data;
  });
}

/* ── 打印 ── */
var _printing = false;
var _ctrlPSaved = null;

function _doPrint() {
  if (_printing) return;
  _printing = true;
  var saved = _expandAllDetails();
  var restored = false;

  function restore() {
    if (restored) return;
    restored = true;
    _restoreAllDetails(saved);
    _printing = false;
  }

  window.addEventListener("afterprint", restore, { once: true });
  try {
    window.print();
  } catch (e) {
    console.error("打印失败:", e);
    restore();
  }
}

/* 入口：kind = "daily"（首页/期次页）| "favorites"（收藏页） */
function adrPrint(kind) {
  if (kind === "favorites") {
    _injectSummaryContent()
      .catch(function (e) { console.error("今日总结注入失败，按当前内容打印:", e); })
      .then(_doPrint);
    return;
  }
  _doPrint();
}

/* ── 复制当期链接 ── */
function _issueShareUrl() {
  var page = document.body.getAttribute("data-page");
  if (page === "archive") {
    return window.location.origin + window.location.pathname;
  }
  var date = window.ADR_SHARE_DATE || window.__ADR_LATEST;
  if (!date) return window.location.origin + window.location.pathname;
  var base = window.location.pathname.replace(/[^\/]*$/, "");
  return window.location.origin + base + "archive/" + date + ".html";
}

/* 降级链：clipboard API → execCommand → 让用户手抄 */
function _legacyCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function adrCopyIssueLink() {
  var url = _issueShareUrl();
  var btn = document.querySelector(".copy-link-btn");

  if (btn && !btn.getAttribute("data-label")) {
    btn.setAttribute("data-label", btn.textContent);
  }
  var label = btn ? btn.getAttribute("data-label") : "";

  function done(ok) {
    if (btn) {
      btn.textContent = ok ? "✅ 已复制" : "⚠️ 复制失败";
      setTimeout(function () { btn.textContent = label; }, 1600);
    }
    if (!ok) window.prompt("自动复制失败，请手动复制这个链接：", url);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      function () { done(true); },
      function () { done(_legacyCopy(url)); }
    );
  } else {
    done(_legacyCopy(url));
  }
}

/* ── Ctrl+P 直按路径：beforeprint 兜底 ── */
window.addEventListener("beforeprint", function () {
  if (_printing) return; /* 按钮路径已自行展开 */
  _printing = true;
  _ctrlPSaved = _expandAllDetails();

  var page = document.body.getAttribute("data-page");
  if (page === "favorites" && _summaryCache) {
    try { _injectSummarySync(_summaryCache); } catch (e) { /* 不影响打印 */ }
  }
});

window.addEventListener("afterprint", function () {
  _restoreAllDetails(_ctrlPSaved);
  _ctrlPSaved = null;
  _printing = false;
});

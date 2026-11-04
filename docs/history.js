(function () {
  "use strict";
  /* ── 历史日报懒加载 ──
     index.html 的 <details class="hist-day"> 空壳展开时，fetch 构建时生成的
     HTML 片段（docs/history/YYYY-MM-DD.html）注入。片段与页面 DOM 同源同函数
     （build_site.py item_line），class/样式/收藏按钮天然一致。
     数据版本 = 构建时间戳（从自身 script src 的 ?v= 提取），代码版本见 fav.js APP_VERSION */

  var VERSION = "";
  try {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/\?v=([^&]+)/);
    if (m) VERSION = m[1];
  } catch (e) { /* file:// 等场景无版本参数，降级为无缓存破坏 */ }

  /* 状态机: date -> { status: 'idle'|'loading'|'loaded'|'error', promise } */
  var state = {};

  function setStatus(box, html, busy) {
    box.setAttribute("aria-busy", busy ? "true" : "false");
    box.innerHTML = html;
  }

  function loadDay(date, box) {
    var s = state[date];
    /* in-flight 复用：展开中关闭再展开不重复请求 */
    if (s && s.status === "loading" && s.promise) return s.promise;
    if (s && s.status === "loaded") return Promise.resolve();

    s = state[date] = { status: "loading", promise: null };
    setStatus(box, '<p class="hist-status" role="status">加载中…</p>', true);

    var p = fetch("history/" + date + ".html" + (VERSION ? "?v=" + VERSION : ""))
      .then(function (r) {
        /* HTTP 错误契约：fetch 对 404/500 不 reject，必须显式检查 response.ok，
           严禁把 GitHub Pages 错误页 HTML 注入 DOM */
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (html) {
        if (state[date] !== s || s.status !== "loading") return; /* 旧请求不覆盖新状态 */
        box.innerHTML = html;
        box.setAttribute("data-loaded", "1");
        s.status = "loaded";
        s.promise = null;
        /* 通知 fav.js 刷新收藏按钮初始态（☆/★） */
        document.dispatchEvent(new CustomEvent("hist:loaded", { detail: { date: date } }));
      })
      .catch(function () {
        if (state[date] !== s) return;
        s.status = "error";
        s.promise = null; /* 清除失败 Promise：重试必须发起全新请求 */
        setStatus(box,
          '<p class="hist-status" role="status">加载失败 ' +
          '<button class="hist-retry" type="button">点击重试</button>，' +
          '或 <a href="archive/' + date + '.html">查看完整日报 →</a></p>', false);
      });
    s.promise = p;
    return p;
  }

  function init() {
    var days = document.querySelectorAll("details.hist-day");
    for (var i = 0; i < days.length; i++) {
      (function (d) {
        var date = d.getAttribute("data-date");
        if (!date) return;
        d.addEventListener("toggle", function () {
          if (!d.open) return;
          var box = d.querySelector(".history-day");
          if (box) loadDay(date, box);
        });
      })(days[i]);
    }
    /* 重试按钮是 error 态动态注入的，用事件委托覆盖 */
    document.addEventListener("click", function (ev) {
      var b = ev.target;
      if (!b.classList || !b.classList.contains("hist-retry")) return;
      var day = b.closest("details.hist-day");
      if (!day) return;
      var date = day.getAttribute("data-date");
      var box = day.querySelector(".history-day");
      if (date && box) loadDay(date, box);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  console.log("history.js v" + (VERSION || "dev") + " loaded");
})();

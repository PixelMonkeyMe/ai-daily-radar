/* history.js —— 日报期次日期导航控制器（PRD v2.2） */
(function () {
  "use strict";
  if (!document.body || document.body.getAttribute("data-page") !== "index") return;
  if (!window.__ADR_ISSUES || !window.__ADR_ISSUES.length) { console.warn("[history] 期次索引缺失，跳过"); return; }

  var ISSUES = window.__ADR_ISSUES.slice();
  var LATEST = window.__ADR_LATEST;
  var DATE_MAP = {};
  ISSUES.forEach(function (it, i) { DATE_MAP[it.date] = i; });

  var nav = document.getElementById("issue-nav");
  var bar = nav ? nav.querySelector(".date-bar") : null;
  var btnPrev = document.getElementById("date-prev");
  var btnNext = document.getElementById("date-next");
  var elMain = document.getElementById("date-main");
  var elSub = document.getElementById("date-sub");
  var elSelect = document.getElementById("date-select");
  var elLive = document.getElementById("issue-live");
  var content = document.getElementById("issue-content");
  var pager = document.getElementById("issue-pager");
  if (!bar || !btnPrev || !btnNext || !elMain || !elSub || !elSelect || !content || !pager) {
    console.warn("[history] 必需节点缺失，跳过"); return;
  }

  var cache = {};
  var reqToken = 0;
  var currentDate = null;

  function parseDate(d) { var p = String(d || "").split("-"); return { y: +p[0], m: +p[1], d: +p[2] }; }
  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  function weekdayOf(d) {
    var o = parseDate(d);
    if (!o.y || !o.m || !o.d) return "";
    return WEEK[new Date(o.y, o.m - 1, o.d).getDay()] || "";
  }
  function mainLabel(d) {
    var o = parseDate(d);
    var head = (o.y && o.y !== new Date().getFullYear()) ? (o.y + "年") : "";
    return head + o.m + "月" + o.d + "日 " + weekdayOf(d);
  }
  function subLabel(idx) {
    var it = ISSUES[idx];
    var tag = it.date === LATEST ? "最新" : (idx === 1 ? "上一期" : "前 " + idx + " 期");
    return tag + " · 共 " + it.count + " 条";
  }
  function validDate(d) { return typeof d === "string" && DATE_MAP.hasOwnProperty(d); }

  function readUrlDate() {
    try { return new URL(location.href).searchParams.get("date"); } catch (e) { return null; }
  }
  function writeUrl(d, replace) {
    try {
      var u = new URL(location.href);
      u.searchParams.set("date", d);
      if (replace) history.replaceState({ date: d }, "", u.toString());
      else history.pushState({ date: d }, "", u.toString());
    } catch (e) {}
  }

  function updateChrome(idx) {
    var it = ISSUES[idx];
    elMain.textContent = mainLabel(it.date);
    elSub.textContent = subLabel(idx);
    bar.classList.toggle("is-history", it.date !== LATEST);

    var canPrev = idx + 1 < ISSUES.length;
    var canNext = idx - 1 >= 0;
    btnPrev.disabled = !canPrev;
    btnNext.disabled = !canNext;

    var older = canPrev ? ISSUES[idx + 1] : null;
    var newer = canNext ? ISSUES[idx - 1] : null;
    pager.innerHTML = "";
    if (older) pager.appendChild(pagerBtn(older, "prev"));
    if (newer) pager.appendChild(pagerBtn(newer, "next"));
    pager.style.display = (older || newer) ? "" : "none";

    var back = nav.querySelector(".date-back-today");
    if (it.date !== LATEST) {
      if (!back) {
        back = document.createElement("button");
        back.type = "button";
        back.className = "date-back-today";
        back.textContent = "回到最新";
        back.addEventListener("click", function () { go(LATEST, false); });
        nav.appendChild(back);
        back = nav.querySelector(".date-back-today");
      }
      back.style.display = "";
    } else if (back) { back.style.display = "none"; }
  }

  function pagerBtn(issue, dir) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pg-" + dir;
    var d1 = document.createElement("span");
    d1.className = "pg-dir";
    d1.textContent = dir === "prev" ? "更早一期" : "更晚一期";
    var d2 = document.createElement("span");
    d2.textContent = mainLabel(issue.date) + " · " + issue.count + " 条";
    b.appendChild(d1); b.appendChild(d2);
    b.addEventListener("click", function () { go(issue.date, false); });
    return b;
  }

  function go(date, replaceUrl) {
    if (!validDate(date)) { date = LATEST; replaceUrl = true; }
    var idx = DATE_MAP[date];
    var myToken = ++reqToken;
    currentDate = date;
    writeUrl(date, replaceUrl);
    updateChrome(idx);
    updateSelect(idx);
    if (cache[date]) { commit(date, cache[date], myToken); return; }
    content.classList.add("issue-loading");
    fetchIssue(date).then(function (html) {
      if (myToken !== reqToken) return;
      cache[date] = html;
      commit(date, html, myToken);
    }).catch(function () {
      if (myToken !== reqToken) return;
      showError(date, idx);
    });
  }

  function firstPaint(date, idx) {
    currentDate = date;
    updateChrome(idx);
    updateSelect(idx);
    writeUrl(date, true);
  }

  function scriptVersion() {
    try {
      var s = document.currentScript || document.querySelector('script[src*="history.js"]');
      var m = s && s.src && s.src.match(/\?v=([^&]+)/);
      return m ? m[1] : "";
    } catch (e) { return ""; }
  }

  function fetchIssue(date) {
    var url = "history/" + date + ".html";
    var v = scriptVersion();
    if (v) url += "?v=" + v;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  function commit(date, html, myToken) {
    if (myToken !== reqToken) return;
    content.setAttribute("data-date", date);
    content.innerHTML = html;
    content.classList.remove("issue-loading");
    var it = ISSUES[DATE_MAP[date]];
    document.dispatchEvent(new CustomEvent("hist:loaded", { detail: { date: date } }));
    announce("已切换到 " + mainLabel(date) + "，共 " + it.count + " 条");
    focusTop();
  }

  function focusTop() {
    try {
      if (!content.hasAttribute("tabindex")) content.setAttribute("tabindex", "-1");
      content.focus({ preventScroll: true });
      /* 下一帧再滚，避开 innerHTML 换内容造成的布局抖动 */
      window.requestAnimationFrame(function () { window.scrollTo(0, 0); });
    } catch (e) {}
  }

  function announce(msg) {
    if (!elLive) return;
    elLive.textContent = "";
    setTimeout(function () { elLive.textContent = msg; }, 30);
  }

  function jumpBtn(text, date) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.addEventListener("click", function () { go(date, false); });
    return b;
  }
  function jumpButtons(older, newer) {
    var w = document.createElement("div");
    w.className = "issue-jump";
    if (older) w.appendChild(jumpBtn("‹ " + mainLabel(older.date), older.date));
    if (newer) w.appendChild(jumpBtn(mainLabel(newer.date) + " ›", newer.date));
    return w;
  }

  function showError(date, idx) {
    content.classList.remove("issue-loading");
    var older = idx + 1 < ISSUES.length ? ISSUES[idx + 1] : null;
    var newer = idx - 1 >= 0 ? ISSUES[idx - 1] : null;
    var box = document.createElement("div");
    box.className = "issue-status";
    box.appendChild(document.createTextNode("加载失败"));
    var w = document.createElement("div");
    var rb = document.createElement("button");
    rb.type = "button";
    rb.textContent = "点击重试";
    rb.addEventListener("click", function () { delete cache[date]; go(date, true); });
    w.appendChild(rb);
    box.appendChild(w);
    box.appendChild(jumpButtons(older, newer));
    content.innerHTML = "";
    content.appendChild(box);
    announce("加载失败，可重试或切换期次");
  }

  /* 无数据日期：URL 保持用户请求的日期，日期栏同步显示，前后期按钮可直达（评审 B3） */
  function enterNoIssue(date) {
    var idxAfter = ISSUES.length;
    for (var i = 0; i < ISSUES.length; i++) { if (ISSUES[i].date < date) { idxAfter = i; break; } }
    var older = idxAfter < ISSUES.length ? ISSUES[idxAfter] : null;      /* 更早一期 */
    var newer = idxAfter - 1 >= 0 ? ISSUES[idxAfter - 1] : null;         /* 更晚一期 */

    elMain.textContent = mainLabel(date);
    elSub.textContent = "该日无日报";
    bar.classList.add("is-history");
    btnPrev.disabled = !older;
    btnNext.disabled = !newer;
    currentDate = (newer || older).date;
    updateSelect(DATE_MAP[currentDate]);

    pager.innerHTML = "";
    if (older) pager.appendChild(pagerBtn(older, "prev"));
    if (newer) pager.appendChild(pagerBtn(newer, "next"));
    pager.style.display = (older || newer) ? "" : "none";

    var back = nav.querySelector(".date-back-today");
    if (!back) {
      back = document.createElement("button");
      back.type = "button";
      back.className = "date-back-today";
      back.textContent = "回到最新";
      back.addEventListener("click", function () { go(LATEST, false); });
      nav.appendChild(back);
    }
    back.style.display = "";

    showNoIssue(date);
  }

  function showNoIssue(date) {
    var o = parseDate(date);
    var idxAfter = 0;
    for (var i = 0; i < ISSUES.length; i++) { if (ISSUES[i].date < date) { idxAfter = i; break; } }
    var older = ISSUES[idxAfter] || null;
    var newer = idxAfter - 1 >= 0 ? ISSUES[idxAfter - 1] : null;
    var box = document.createElement("div");
    box.className = "issue-status";
    box.appendChild(document.createTextNode(o.m + " 月 " + o.d + " 日（" + (weekdayOf(date) || "未知") + "）没有日报"));
    box.appendChild(jumpButtons(older, newer));
    content.setAttribute("data-date", date);
    content.innerHTML = "";
    content.appendChild(box);
    announce(o.m + " 月 " + o.d + " 日没有日报");
  }

  function buildSelect() {
    ISSUES.forEach(function (it, i) {
      var opt = document.createElement("option");
      opt.value = it.date;
      opt.textContent = mainLabel(it.date) + "（" + (it.date === LATEST ? "最新" : "第 " + (i + 1) + " 期") + " · " + it.count + " 条）";
      elSelect.appendChild(opt);
    });
    elSelect.addEventListener("change", function () { go(elSelect.value, false); });
  }
  function updateSelect(idx) {
    var d = ISSUES[idx].date;
    if (elSelect.value !== d) elSelect.value = d;
  }

  btnPrev.addEventListener("click", function () {
    var idx = DATE_MAP[currentDate];
    if (idx + 1 < ISSUES.length) go(ISSUES[idx + 1].date, false);
  });
  btnNext.addEventListener("click", function () {
    var idx = DATE_MAP[currentDate];
    if (idx - 1 >= 0) go(ISSUES[idx - 1].date, false);
  });
  window.addEventListener("popstate", function () {
    var d = readUrlDate();
    if (!validDate(d)) d = LATEST;
    go(d, true);
  });

  buildSelect();
  var initDate = readUrlDate();
  if (validDate(initDate)) {
    if (initDate === LATEST) firstPaint(initDate, 0);
    else go(initDate, true);
  } else if (initDate) {
    enterNoIssue(initDate);          /* 合法格式但无数据：保持 URL 与视觉一致 */
  } else {
    firstPaint(LATEST, 0);
  }

  console.log("history.js ready · issues=" + ISSUES.length + " · latest=" + LATEST);
})();

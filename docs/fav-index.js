/* fav-index.js —— 时段 AI 分析 + renderMarkdown（由 fav.js 拆分）
   依赖: fav-core.js（window.ADR，仅 guard）。激活条件: data-page="index" 且 #range-analyzer 存在。 */
(function () {
  if (!window.ADR) { console.error("[fav-index] fav-core.js 未加载，模块跳过"); return; }
  if (document.body.getAttribute("data-page") !== "index") return;
  if (!document.querySelector(".range-analyzer")) { console.error("[fav-index] 必需锚点 .range-analyzer 缺失"); return; }

  /* ── 时段 AI 分析 ── */
  var EDGE_FUNCTION_URL = ADR.supabaseUrl + "/functions/v1/analyze-range";

  function _fmtDate(d) {
    var y = d.getFullYear();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + day;
  }

  function _setRangeInputs(startDate, endDate) {
    var s = document.getElementById("range-start");
    var e = document.getElementById("range-end");
    if (s) s.value = startDate;
    if (e) e.value = endDate;
  }

  function _setQuickBtnActive(rangeType) {
    var btns = document.querySelectorAll(".range-quick-btn");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute("data-range") === rangeType) {
        btns[i].classList.add("active");
      } else {
        btns[i].classList.remove("active");
      }
    }
  }

  function _setQuickBtnsDisabled(disabled) {
    var btns = document.querySelectorAll(".range-quick-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = disabled;
    }
  }

  window.adrSetQuickRange = function (rangeType) {
    var today = new Date();
    var start, end = _fmtDate(today);

    if (rangeType === "week") {
      var day = today.getDay();
      var diff = day === 0 ? 6 : day - 1;
      var monday = new Date(today);
      monday.setDate(today.getDate() - diff);
      start = _fmtDate(monday);
    } else if (rangeType === "halfmonth") {
      var d = new Date(today);
      d.setDate(today.getDate() - 14);
      start = _fmtDate(d);
    } else if (rangeType === "month") {
      start = today.getFullYear() + "-" + ("0" + (today.getMonth() + 1)).slice(-2) + "-01";
    } else if (rangeType === "quarter") {
      var qMonth = Math.floor(today.getMonth() / 3) * 3;
      start = today.getFullYear() + "-" + ("0" + (qMonth + 1)).slice(-2) + "-01";
    } else {
      return;
    }

    _setRangeInputs(start, end);
    _setQuickBtnActive(rangeType);
    window.adrAnalyzeRange();
  };

  window.adrAnalyzeRange = async function () {
    var startInput = document.getElementById("range-start");
    var endInput = document.getElementById("range-end");
    var resultDiv = document.getElementById("range-result");
    var btn = document.getElementById("range-analyze-btn");

    var startDate = startInput ? startInput.value : "";
    var endDate = endInput ? endInput.value : "";

    if (!startDate || !endDate) {
      if (resultDiv) resultDiv.innerHTML = '<p style="color:#e63946">请选择开始和结束日期</p>';
      return;
    }

    if (startDate > endDate) {
      if (resultDiv) resultDiv.innerHTML = '<p style="color:#e63946">开始日期不能晚于结束日期</p>';
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "分析中..."; }
    _setQuickBtnsDisabled(true);
    if (resultDiv) resultDiv.innerHTML = '<p style="color:#1677ff">🔄 正在分析 ' + startDate + ' 至 ' + endDate + ' 的数据，请稍候（约 10-30 秒）...</p>';

    try {
      var res = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + ADR.supabaseKey
        },
        body: JSON.stringify({ start_date: startDate, end_date: endDate })
      });

      var data = await res.json();

      if (btn) { btn.disabled = false; btn.textContent = "开始 AI 分析"; }
      _setQuickBtnsDisabled(false);

      if (!data.success) {
        if (resultDiv) resultDiv.innerHTML = '<p style="color:#e63946">分析失败：' + (data.error || "未知错误") + '</p>';
        return;
      }

      if (!data.data) {
        if (resultDiv) resultDiv.innerHTML = '<p style="color:#8a919c">' + (data.message || "该时段暂无数据") + '</p>';
        return;
      }

      // Render the analysis result as markdown-like HTML
      var html = '<div class="card summary-card">';
      html += '<h3 class="summary-title">📊 ' + startDate + ' 至 ' + endDate + ' AI 分析报告</h3>';
      if (data.cached) {
        html += '<p style="color:#8a919c;font-size:12px">（缓存结果）</p>';
      }
      html += '<div style="margin-top:16px;line-height:1.8">';
      html += renderMarkdown(data.data);
      html += '</div></div>';

      if (resultDiv) resultDiv.innerHTML = html;

    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "开始 AI 分析"; }
      _setQuickBtnsDisabled(false);
      if (resultDiv) resultDiv.innerHTML = '<p style="color:#e63946">请求失败：' + e.message + '</p>';
    }
  };

  // 手动修改日期时清除快捷按钮高亮
  (function () {
    var inputs = document.querySelectorAll("#range-start, #range-end");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("change", function () { _setQuickBtnActive(""); });
    }
  })();

  /* 简单的 Markdown 渲染 */
  function renderMarkdown(text) {
    return text
      .replace(/^## (.+)$/gm, '<h3 style="color:#203a43;margin:20px 0 10px;font-size:18px;border-left:4px solid #1677ff;padding-left:10px">$1</h3>')
      .replace(/^### (.+)$/gm, '<h4 style="color:#2c5364;margin:16px 0 8px;font-size:16px">$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li style="margin:4px 0;margin-left:20px">$1</li>')
      .split('\n\n').join('<br><br>')
      .split('\n').join('<br>');
  }

  /* ── 我的标注区块：首页展示已收藏且有备注/标签的条目（回顾端，补全 3.3d 写入口） ── */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* 字段规范化（评审[阻塞]1）：旧收藏可能缺 context 字段或值为非字符串 */
  function normStr(v) { return typeof v === "string" ? v.trim() : ""; }
  function parseTags(v) {
    if (Array.isArray(v)) return v.map(function (t) { return normStr(t); }).filter(Boolean);
    return normStr(v).split(",").map(function (t) { return t.trim(); }).filter(Boolean);
  }
  function hasContext(f) {
    return normStr(f.context_note).length > 0 || parseTags(f.context_tags).length > 0;
  }
  function safeHref(u) {
    var s = normStr(u);
    return /^https?:\/\//i.test(s) ? s : ""; /* 仅允许 http/https（评审建议4） */
  }

  var notesScheduled = false;
  function scheduleNotes() {
    if (notesScheduled) return; /* 同帧合并高频 favs:changed（评审建议3） */
    notesScheduled = true;
    window.requestAnimationFrame(function () { notesScheduled = false; renderMyNotes(); });
  }

  function removeNotesBlock() {
    var el = document.querySelector(".my-notes");
    if (el) el.remove();
  }

  function renderMyNotes() {
    var existing = document.querySelector(".my-notes");
    var wasOpen = existing ? existing.open : false; /* 保留展开状态（评审建议3） */
    if (!ADR.isLoggedIn() || !document.body ||
        (document.body.getAttribute("data-page") !== "index")) {
      removeNotesBlock(); return;
    }
    var items = ADR.load().filter(hasContext).sort(function (a, b) {
      return normStr(b.d).localeCompare(normStr(a.d));
    });
    if (!items.length) { removeNotesBlock(); return; }

    var list = document.createElement("div");
    list.className = "my-notes-list";
    items.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "my-notes-item";

      var head = document.createElement("div");
      head.className = "my-notes-head";
      var src = document.createElement("span");
      src.className = "tag-src";
      src.textContent = normStr(f.s); /* 用户文本一律 textContent（评审建议4） */
      head.appendChild(src);
      var href = safeHref(f.u);
      if (href) {
        var a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = normStr(f.t);
        head.appendChild(a);
      } else {
        var titleSpan = document.createElement("span");
        titleSpan.className = "my-notes-title";
        titleSpan.textContent = normStr(f.t);
        head.appendChild(titleSpan);
      }
      item.appendChild(head);

      var note = normStr(f.context_note);
      if (note) {
        var nd = document.createElement("div");
        nd.className = "my-notes-note";
        nd.textContent = note;
        item.appendChild(nd);
      }

      var tags = parseTags(f.context_tags);
      if (tags.length) {
        var tw = document.createElement("div");
        tw.className = "my-notes-tags";
        tags.forEach(function (t) { /* 逐个创建并 textContent，不做整体模板 */
          var chip = document.createElement("span");
          chip.className = "my-notes-tag";
          chip.textContent = t;
          tw.appendChild(chip);
        });
        item.appendChild(tw);
      }
      list.appendChild(item);
    });

    if (existing) {
      existing.innerHTML = "";
      existing.appendChild(list); /* 只更新列表内容，保留 details.open/焦点 */
      existing.open = wasOpen;
      return;
    }

    var det = document.createElement("details");
    det.className = "my-notes";
    var sum = document.createElement("summary");
    var label = document.createElement("span");
    label.textContent = "⭐ 我的标注 ";
    var cnt = document.createElement("span");
    cnt.className = "my-notes-count";
    cnt.textContent = items.length;
    var tail = document.createElement("span");
    tail.textContent = " · 点击展开";
    sum.appendChild(label);
    sum.appendChild(cnt);
    sum.appendChild(tail);
    det.appendChild(sum);
    det.appendChild(list);

    var anchor = document.querySelector(".archive");
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(det, anchor);
      return;
    }
    var footer = document.querySelector("footer");
    if (footer && footer.parentNode) footer.parentNode.insertBefore(det, footer);
    /* 都找不到则不渲染（防御，评审确认合理） */
  }

  document.addEventListener("favs:changed", scheduleNotes);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleNotes);
  } else {
    scheduleNotes();
  }

})();
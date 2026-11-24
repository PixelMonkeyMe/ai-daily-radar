/* fav-index.js —— 时段 AI 分析（Markdown 渲染复用 ADR.renderNoteMd）
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

  /* 安全设置结果区文本（用户/API/异常信息一律走 textContent，不进 innerHTML） */
  function setResultText(color, text) {
    var el = document.getElementById("range-result");
    if (!el) return;
    el.textContent = "";
    var p = document.createElement("p");
    p.style.color = color;
    p.textContent = text;
    el.appendChild(p);
  }

  window.adrAnalyzeRange = async function () {
    var startInput = document.getElementById("range-start");
    var endInput = document.getElementById("range-end");
    var resultDiv = document.getElementById("range-result");
    var btn = document.getElementById("range-analyze-btn");

    var startDate = startInput ? startInput.value : "";
    var endDate = endInput ? endInput.value : "";

    if (!startDate || !endDate) {
      if (resultDiv) resultDiv.innerHTML = '<p style="color:var(--accent)">请选择开始和结束日期</p>';
      return;
    }

    if (startDate > endDate) {
      if (resultDiv) resultDiv.innerHTML = '<p style="color:var(--accent)">开始日期不能晚于结束日期</p>';
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "分析中..."; }
    _setQuickBtnsDisabled(true);
    setResultText("var(--ink)", " 正在分析 " + startDate + " 至 " + endDate + " 的数据，请稍候（约 10-30 秒）...");

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
        setResultText("var(--accent)", "分析失败：" + (data.error || "未知错误"));
        return;
      }

      if (!data.data) {
        setResultText("var(--muted)", data.message || "该时段暂无数据");
        return;
      }

      // Render the analysis result as markdown-like HTML
      /* 复用备注的 Markdown 渲染器（ADR.renderNoteMd）：DOM 构建、支持表格、
         继承 XSS 安全基线。视觉向备注靠拢（正文 13px / 行高 1.7 / 标题一级） */
      if (resultDiv) {
        resultDiv.textContent = "";
        var card = document.createElement("div");
        card.className = "card summary-card";

        var titleEl = document.createElement("h3");
        titleEl.className = "summary-title";
        titleEl.textContent = " " + startDate + " 至 " + endDate + " AI 分析报告";
        card.appendChild(titleEl);

        if (data.cached) {
          var cachedEl = document.createElement("p");
          cachedEl.style.cssText = "color:var(--muted);font-size:12px";
          cachedEl.textContent = "（缓存结果）";
          card.appendChild(cachedEl);
        }

        var bodyEl = document.createElement("div");
        bodyEl.className = "note-md";   /* 复用备注排版（表格/标题/列表样式随之生效） */
        bodyEl.style.marginTop = "16px";
        bodyEl.appendChild(ADR.renderNoteMd(data.data));
        card.appendChild(bodyEl);

        resultDiv.appendChild(card);
      }

    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "开始 AI 分析"; }
      _setQuickBtnsDisabled(false);
      setResultText("var(--accent)", "请求失败：" + (e && e.message ? e.message : "未知错误"));
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



})();
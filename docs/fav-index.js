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
    setResultText("#1677ff", "🔄 正在分析 " + startDate + " 至 " + endDate + " 的数据，请稍候（约 10-30 秒）...");

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
        setResultText("#e63946", "分析失败：" + (data.error || "未知错误"));
        return;
      }

      if (!data.data) {
        setResultText("#8a919c", data.message || "该时段暂无数据");
        return;
      }

      // Render the analysis result as markdown-like HTML
      var html = '<div class="card summary-card">';
      html += '<h3 class="summary-title">📊 ' + escapeHtml(startDate) + ' 至 ' + escapeHtml(endDate) + ' AI 分析报告</h3>';
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
      setResultText("#e63946", "请求失败：" + (e && e.message ? e.message : "未知错误"));
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
  /* XSS 防护：LLM 输出是不可信内容，必须先转义再套 Markdown 语法 */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

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

  function renderMarkdown(text) {
    return escapeHtml(text)
      .replace(/^## (.+)$/gm, '<h3 style="color:#203a43;margin:20px 0 10px;font-size:18px;border-left:4px solid #1677ff;padding-left:10px">$1</h3>')
      .replace(/^### (.+)$/gm, '<h4 style="color:#2c5364;margin:16px 0 8px;font-size:16px">$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li style="margin:4px 0;margin-left:20px">$1</li>')
      .split('\n\n').join('<br><br>')
      .split('\n').join('<br>');
  }



})();
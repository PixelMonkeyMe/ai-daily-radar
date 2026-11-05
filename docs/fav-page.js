/* fav-page.js —— 收藏夹页 UI：筛选/排序/渲染/分类tab/导出/总结弹窗（由 fav.js 拆分）
   依赖: fav-core.js（window.ADR）。激活条件: data-page="favorites" 且 #fav-list 存在。 */
(function () {
  if (!window.ADR) { console.error("[fav-page] fav-core.js 未加载，模块跳过"); return; }
  if (document.body.getAttribute("data-page") !== "favorites") return;
  if (!document.getElementById("fav-list")) { console.error("[fav-page] 必需锚点 #fav-list 缺失"); return; }

  /* summary:// 条目点击（由 core 的 buildFavCard 派发）→ 总结弹窗（渲染前注册，评审建议） */
  document.addEventListener("summary:open", function (ev) {
    showSummaryModal(ev.detail && ev.detail.id, ev.detail && ev.detail.title);
  });

  /* 从 core 初始化区移入：搜索框 readonly 解除 + input 触发重渲染 */
  document.addEventListener("DOMContentLoaded", function () {
    var q = document.getElementById("fav-q");
    if (q) {
      /* 搜索框初始 readonly 防浏览器自动填充，2 秒后解除 */
      setTimeout(function () { q.removeAttribute("readonly"); }, 2000);
      q.addEventListener("input", renderFavPage);
    }
  });

  /* core 派发 favs:changed（收藏/认证/上下文变更）→ 重渲染（同步派发，时序与拆分前一致） */
  document.addEventListener("favs:changed", renderFavPage);

  /* ── 筛选/排序 ── */
  var sortDesc = true;
  var filterDate = "";
  var filterFrom = "";
  var filterTo = "";
  var filterCategory = "";

  window.adrToggleSort = function () { sortDesc = !sortDesc; renderFavPage(); };

  window.adrFilterDate = function () {
    filterDate = (document.getElementById("fav-date").value || "");
    filterFrom = (document.getElementById("fav-date-from").value || "");
    filterTo = (document.getElementById("fav-date-to").value || "");
    renderFavPage();
  };

  window.adrResetDate = function () {
    filterDate = ""; filterFrom = ""; filterTo = "";
    document.getElementById("fav-date").value = "";
    document.getElementById("fav-date-from").value = "";
    document.getElementById("fav-date-to").value = "";
    renderFavPage();
  };

  window.adrFilterCategory = function (cat) {
    filterCategory = (filterCategory === cat) ? "" : cat;
    renderFavPage();
  };

  /* ── 筛选状态读写（供 PDF 导出等外部功能使用） ── */
  window.adrGetFilterState = function () {
    return {
      category: filterCategory,
      date: filterDate,
      from: filterFrom,
      to: filterTo,
      search: document.getElementById("fav-q") ? document.getElementById("fav-q").value : "",
      sortDesc: sortDesc
    };
  };

  window.adrSetFilterState = function (state) {
    if (!state) return;
    filterCategory = state.category || "";
    filterDate = state.date || "";
    filterFrom = state.from || "";
    filterTo = state.to || "";
    sortDesc = state.sortDesc !== undefined ? state.sortDesc : true;
    if (document.getElementById("fav-q")) document.getElementById("fav-q").value = state.search || "";
    if (document.getElementById("fav-date")) document.getElementById("fav-date").value = state.date || "";
    if (document.getElementById("fav-date-from")) document.getElementById("fav-date-from").value = state.from || "";
    if (document.getElementById("fav-date-to")) document.getElementById("fav-date-to").value = state.to || "";
    renderFavPage();
  };

  /* ─ 收藏夹页面渲染 ── */
  function renderFavPage() {
    var list = document.getElementById("fav-list");
    if (!list) return;
    if (!ADR.isLoggedIn()) {
      list.innerHTML = '<p style="color:#8a919c;font-size:14px;margin:12px 0">请先登录查看收藏。</p>';
      document.getElementById("fav-count") && (document.getElementById("fav-count").textContent = "");
      renderCategoryTabs([]);
      return;
    }
    var favs = ADR.load();
    /* 确保每条收藏都有分类（兼容旧数据） */
    favs.forEach(function (f) {
      if (!f.c) f.c = ADR.autoCategorize(f.s || "", f.t || "", f.b || "");
    });
    /* 渲染分类 tab */
    renderCategoryTabs(favs);
    var qEl = document.getElementById("fav-q");
    var q = ((qEl && qEl.value) || "").toLowerCase();
    var items = favs.filter(function (f) {
      // 扩大搜索范围：标题 + 总结 + 来源 + 分类 + 成熟度 + 场景标签 + 备注 + AI分析
      if (q) {
        var searchText = [
          f.t || "",           // 标题
          f.b || "",           // 总结/摘要（brief）
          f.s || "",           // 来源
          f.c || "",           // 分类
          f.m || "",           // 成熟度
          f.context_tags || "", // 场景标签
          f.context_note || "", // 备注
          f.what || "",        // AI分析：这是什么
          f.industry_use || "", // AI分析：对行业有什么用
          f.capability || "",  // AI分析：能干什么
          f.assessment || "",  // AI分析：评估判断
          f.risk || ""         // AI分析：风险提示
        ].join(" ").toLowerCase();
        if (searchText.indexOf(q) < 0) return false;
      }
      var d = f.d || "";
      if (filterDate && d !== filterDate) return false;
      if (filterFrom && d < filterFrom) return false;
      if (filterTo && d > filterTo) return false;
      if (filterCategory && f.c !== filterCategory) return false;
      return true;
    });
    items.sort(function (a, b) {
      var c = (a.d || "").localeCompare(b.d || "") || (a.t || "").localeCompare(b.t || "");
      return sortDesc ? -c : c;
    });
    var sortEl = document.getElementById("fav-sort");
    if (sortEl) sortEl.textContent = sortDesc ? "按日期：新 → 旧" : "按日期：旧 → 新";
    var countEl = document.getElementById("fav-count");
    if (countEl) countEl.textContent = "共 " + favs.length + " 条收藏" + (q ? "，匹配 " + items.length + " 条" : "");
    list.innerHTML = "";
    if (!items.length) {
      var p = document.createElement("p");
      p.style.cssText = "color:#8a919c;font-size:14px;margin:12px 0";
      p.textContent = favs.length ? "没有匹配的收藏。" : "还没有收藏。去日报页点条目旁的 ☆ 即可收藏。";
      list.appendChild(p);
      return;
    }
    items.forEach(function (f) {
      list.appendChild(ADR.buildFavCard(f));
    });
  }

  /* ── 分类 tab 渲染 ── */
  function renderCategoryTabs(favs) {
    var container = document.getElementById("fav-categories");
    if (!container) return;
    var counts = { "全部": favs.length };
    ADR.CATEGORIES.forEach(function (cat) { counts[cat.name] = 0; });
    counts["行业趋势"] = 0;
    favs.forEach(function (f) {
      var c = f.c || "行业趋势";
      counts[c] = (counts[c] || 0) + 1;
    });
    var html = "";
    var allActive = filterCategory === "" ? " style=\"background:#1677ff;color:#fff\"" : "";
    html += '<button class="fav-cat-tab" onclick="adrFilterCategory(\'\')"' + allActive + ' style="padding:4px 12px;border:1px solid #d9dde3;border-radius:16px;font-size:13px;cursor:pointer;margin:2px;background:' + (filterCategory === "" ? "#1677ff" : "#fff") + ';color:' + (filterCategory === "" ? "#fff" : "#333") + '">全部(' + counts["全部"] + ')</button>';
    ADR.CATEGORIES.forEach(function (cat) {
      var active = filterCategory === cat.name;
      html += '<button class="fav-cat-tab" onclick="adrFilterCategory(\'' + cat.name + '\')" style="padding:4px 12px;border:1px solid #d9dde3;border-radius:16px;font-size:13px;cursor:pointer;margin:2px;background:' + (active ? "#1677ff" : "#fff") + ';color:' + (active ? "#fff" : "#333") + '">' + cat.icon + ' ' + cat.name + '(' + (counts[cat.name] || 0) + ')</button>';
    });
    /* 行业趋势（不在 ADR.CATEGORIES 数组里的默认分类） */
    var trendActive = filterCategory === "行业趋势";
    html += '<button class="fav-cat-tab" onclick="adrFilterCategory(\'行业趋势\')" style="padding:4px 12px;border:1px solid #d9dde3;border-radius:16px;font-size:13px;cursor:pointer;margin:2px;background:' + (trendActive ? "#1677ff" : "#fff") + ';color:' + (trendActive ? "#fff" : "#333") + '">📊 行业趋势(' + (counts["行业趋势"] || 0) + ')</button>';
    container.innerHTML = html;
  }

  window.adrExport = function () {
    var data = JSON.stringify(ADR.load(), null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ai-daily-radar-favorites.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ── 今日总结弹窗 ── */
  var _summariesCache = null;

  async function _loadSummaries() {
    if (_summariesCache) return _summariesCache;
    try {
      /* summaries.json 路径：收藏夹页在根目录用 summaries.json，归档页用 ../summaries.json */
      var prefix = window.location.pathname.indexOf("/archive/") >= 0 ? "../" : "";
      var res = await fetch(prefix + "summaries.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      _summariesCache = await res.json();
      return _summariesCache;
    } catch (e) {
      console.warn("load summaries failed:", e);
      _summariesCache = {};
      return _summariesCache;
    }
  }

  window.showSummaryModal = async function (date, title) {
    var summaries = await _loadSummaries();
    var s = summaries[date];
    var html = '<div style="padding:0 2px;line-height:1.75;text-align:left">';
    if (!s) {
      html += '<p style="color:#8a919c">该日总结内容暂未索引，请查看对应日报页面。</p>';
      html += '<p style="font-size:13px"><a href="' + (window.location.pathname.indexOf("/archive/") >= 0 ? "../" : "") + 'archive/' + date + '.html" target="_blank" style="color:#1677ff">打开 ' + date + ' 日报 →</a></p>';
    } else {
      html += '<h4 style="color:#203a43;margin:0 0 6px"> 今日总览</h4>';
      html += '<p style="margin:0 0 12px">' + (s.overview || "") + '</p>';
      if (s.conclusions && s.conclusions.length) {
        html += '<h4 style="color:#203a43;margin:0 0 6px">🎯 核心结论</h4><ul style="margin:0 0 12px;padding-left:20px">';
        s.conclusions.forEach(function (c) { html += '<li style="margin:3px 0">' + c + '</li>'; });
        html += '</ul>';
      }
      if (s.top_picks && s.top_picks.length) {
        html += '<h4 style="color:#203a43;margin:0 0 6px">⭐ 今日重点关注</h4>';
        s.top_picks.forEach(function (p) {
          html += '<div style="margin:0 0 6px"><b>' + (p.title || "") + '</b><br><span style="color:#555;font-size:13.5px">' + (p.reason || "") + '</span></div>';
        });
        html += '<div style="margin-bottom:12px"></div>';
      }
      if (s.industry_use) {
        html += '<h4 style="color:#203a43;margin:0 0 6px">💡 对行业有什么用？</h4>';
        html += '<p style="margin:0 0 12px">' + s.industry_use + '</p>';
      }
      if (s.risks) {
        html += '<h4 style="color:#203a43;margin:0 0 6px">⚠️ 风险提示</h4>';
        html += '<p style="margin:0">' + s.risks + '</p>';
      }
    }
    html += '</div>';
    var _prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    var overlay = document.createElement("div");
    overlay.className = "adr-modal-overlay";
    overlay.style.cssText = "display:flex;z-index:10001";
    var modal = document.createElement("div");
    modal.className = "adr-modal";
    modal.style.cssText = "position:relative;max-width:680px;width:92%;max-height:92vh;overflow-y:auto";
    modal.innerHTML = '<button class="adr-modal-close" id="summary-modal-close">&times;</button>' +
      '<h3>' + (title || "今日总结 · " + date) + '</h3>' + html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    function _closeModal() {
      overlay.remove();
      document.body.style.overflow = _prevBodyOverflow || "";
    }
    document.getElementById("summary-modal-close").onclick = _closeModal;
    overlay.onclick = function (e) { if (e.target === overlay) _closeModal(); };
    document.addEventListener("keydown", _closeModal);
    modal.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });
  };

})();


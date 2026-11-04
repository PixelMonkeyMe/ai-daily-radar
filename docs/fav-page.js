/* fav-page.js —— 收藏夹页 UI：筛选/排序/渲染/分类tab/导出/总结弹窗（由 fav.js 拆分）
   依赖: fav-core.js（window.ADR）。激活条件: data-page="favorites" 且 #fav-list 存在。 */
(function () {
  if (!window.ADR) { console.error("[fav-page] fav-core.js 未加载，模块跳过"); return; }
  if (document.body.getAttribute("data-page") !== "favorites") return;
  if (!document.getElementById("fav-list")) { console.error("[fav-page] 必需锚点 #fav-list 缺失"); return; }

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
      var card = document.createElement("div");
      card.className = "card";
      var h = document.createElement("h2");
      var a = document.createElement("a");
      /* summary:// 链接 → 点击弹窗展示完整内容，而非跳转空白页 */
      if (/^summary:\/\//.test(f.u)) {
        a.href = "javascript:void(0)";
        a.style.cursor = "pointer";
        a.onclick = function () { showSummaryModal(f.u.replace("summary://", ""), f.t); };
      } else {
        a.href = f.u; a.target = "_blank"; a.rel = "noopener";
      }
      a.textContent = f.t;
      h.appendChild(a);
      var btn = document.createElement("button");
      btn.className = "fav-btn on"; btn.textContent = "★"; btn.title = "取消收藏";
      btn.setAttribute("data-t", f.t || ""); btn.setAttribute("data-u", f.u || "");
      btn.setAttribute("data-s", f.s || ""); btn.setAttribute("data-d", f.d || "");
      btn.setAttribute("data-b", f.b || "");
      h.appendChild(btn);
      card.appendChild(h);
      var meta = document.createElement("div");
      meta.className = "tags";
      /* 分类标签 */
      var catInfo = ADR.getCategoryInfo(f.c || "行业趋势");
      var catTag = document.createElement("span");
      catTag.style.cssText = "background:#f0f7ff;color:#1677ff;border-radius:6px;padding:1px 8px;margin-right:8px;font-size:12px";
      catTag.textContent = catInfo.icon + " " + catInfo.name;
      meta.appendChild(catTag);
      /* 成熟度标签 */
      var mat = f.m || "";
      if (mat) {
        var matTag = document.createElement("span");
        var matColor = mat === "S" ? "#52c41a" : mat === "A" ? "#1677ff" : "#8a919c";
        var matText = mat === "S" ? "已落地" : mat === "A" ? "有POC" : "仅demo";
        matTag.style.cssText = "background:" + matColor + "22;color:" + matColor + ";border-radius:6px;padding:1px 8px;margin-right:8px;font-size:12px;font-weight:600";
        matTag.textContent = matText;
        meta.appendChild(matTag);
      }
      /* 上下文标签 */
      if (f.context_tags) {
        var tags = f.context_tags.split(',').filter(function(t) { return t.trim(); });
        tags.forEach(function(tag) {
          var tagEl = document.createElement('span');
          tagEl.style.cssText = "background:#f0f0f0;color:#666;border-radius:4px;padding:2px 8px;margin-right:6px;font-size:12px";
          tagEl.textContent = '#' + tag.trim();
          meta.appendChild(tagEl);
        });
      }
      var src = document.createElement("span");
      src.className = "tag-src"; src.textContent = f.s || "";
      meta.appendChild(src);
      meta.appendChild(document.createTextNode(" " + (f.d || "")));
      card.appendChild(meta);
      if (f.b) {
        var br = document.createElement("p");
        br.className = "brief"; br.textContent = f.b;
        card.appendChild(br);
      }
      /* Phase 3.3c: 显示完整 AI 分析（非 summary:// 类型） */
      if (f.what || f.industry_use || f.capability || f.assessment || f.risk) {
        var analysisDiv = document.createElement("div");
        analysisDiv.style.cssText = "background:#f8f9fa;border-left:3px solid #1677ff;padding:12px;margin-top:10px;font-size:13px;color:#333;border-radius:4px;line-height:1.6";
        var analysisHtml = "";
        if (f.importance && f.importance > 0) {
          var stars = "⭐".repeat(f.importance);
          analysisHtml += '<div style="margin-bottom:8px"><strong style="color:#1677ff">重要度：</strong>' + stars + ' <span style="color:#8a919c;font-size:12px">(' + f.importance + '/5)</span></div>';
        }
        if (f.what) {
          analysisHtml += '<div style="margin-bottom:6px"><strong style="color:#203a43">💡 这是什么：</strong>' + f.what.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
        }
        if (f.industry_use) {
          analysisHtml += '<div style="margin-bottom:6px"><strong style="color:#203a43">🏭 对行业有什么用：</strong>' + f.industry_use.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
        }
        if (f.capability) {
          analysisHtml += '<div style="margin-bottom:6px"><strong style="color:#203a43">🔧 能干什么：</strong>' + f.capability.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
        }
        if (f.assessment) {
          analysisHtml += '<div style="margin-bottom:6px"><strong style="color:#203a43">📊 评估判断：</strong>' + f.assessment.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
        }
        if (f.risk) {
          analysisHtml += '<div style="margin-bottom:6px"><strong style="color:#e63946">⚠️ 风险提示：</strong>' + f.risk.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
        }
        analysisDiv.innerHTML = analysisHtml;
        card.appendChild(analysisDiv);
      }
      /* 收藏备注 */
      if (f.context_note) {
        var noteEl = document.createElement("div");
        noteEl.className = "context-note-display";
        noteEl.style.cssText = "background:#fffbe6;border-left:3px solid #faad14;padding:8px 12px;margin-top:8px;font-size:13px;color:#555;border-radius:4px;line-height:1.5";
        noteEl.innerHTML = '<strong style="color:#8a7d00"> 我的备注：</strong>' + f.context_note.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        card.appendChild(noteEl);
      }
      /* 编辑上下文按钮 - 根据是否有备注显示不同状态 */
      var editBtn = document.createElement("button");
      editBtn.className = "context-edit-btn";
      var hasNote = f.context_note || f.context_tags;
      editBtn.textContent = hasNote ? "️ 编辑上下文（已填写）" : "✏️ 添加上下文";
      editBtn.style.cssText = "background:" + (hasNote ? "#f0f7ff" : "#fff") + ";border:1px solid " + (hasNote ? "#1677ff" : "#d9d9d9") + ";border-radius:4px;padding:4px 12px;font-size:12px;color:" + (hasNote ? "#1677ff" : "#666") + ";cursor:pointer;margin-top:8px";
      editBtn.onclick = function() { showContextEditDialog(f); };
      card.appendChild(editBtn);
      list.appendChild(card);
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


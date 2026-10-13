(function () {
  /* ── Supabase 配置 ── */
  var SUPABASE_URL = "https://bvhzexdluniqdwmsxaxw.supabase.co";
  var SUPABASE_KEY = "sb_publishable_ZkAEga1YBOmfUrFba7yFYQ_5gt4kkMj";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var KEY = "adr_favs";       // localStorage 缓存键
  var cache = [];              // 内存缓存
  var currentUser = null;      // 当前登录用户
  var pendingFav = null;       // 待收藏项（登录后自动收藏）

  /* ── 工具函数 ── */
  function localLoad() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function localSave(favs) {
    localStorage.setItem(KEY, JSON.stringify(favs));
  }
  function rowToFav(r) {
    return { u: r.url, t: r.title || "", s: r.source || "", d: r.date || "", b: r.brief || "" };
  }
  function favToRow(f, userId) {
    return { url: f.u, title: f.t || "", source: f.s || "", date: f.d || "", brief: f.b || "", user_id: userId };
  }

  /* ── 认证相关 ── */
  function isLoggedIn() { return !!currentUser; }

  async function checkAuth() {
    var res = await sb.auth.getUser();
    currentUser = (res.data && res.data.user) ? res.data.user : null;
    updateAuthUI();
    return currentUser;
  }

  function updateAuthUi() {
    /* 导航栏登录状态 */
    var loginBtn = document.getElementById("adr-login-btn");
    var logoutBtn = document.getElementById("adr-logout-btn");
    var userInfo = document.getElementById("adr-user-info");
    if (loginBtn) loginBtn.style.display = currentUser ? "none" : "inline-block";
    if (logoutBtn) logoutBtn.style.display = currentUser ? "inline-block" : "none";
    if (userInfo) {
      userInfo.style.display = currentUser ? "inline" : "none";
      if (currentUser) userInfo.textContent = currentUser.email;
    }
    /* 收藏夹页面状态 */
    var syncEl = document.getElementById("fav-sync-status");
    if (syncEl && currentUser) {
      syncEl.textContent = "已同步 · " + currentUser.email;
    }
  }

  var loginEmail = "";  // 当前登录邮箱

  /* 显示登录弹窗 */
  function showLoginModal() {
    var modal = document.getElementById("adr-login-modal");
    if (modal) {
      modal.style.display = "flex";
      resetLoginModal();
    }
  }

  function hideLoginModal() {
    var modal = document.getElementById("adr-login-modal");
    if (modal) modal.style.display = "none";
    resetLoginModal();
  }

  function resetLoginModal() {
    loginEmail = "";
    var step1 = document.getElementById("adr-login-step1");
    var step2 = document.getElementById("adr-login-step2");
    var emailInput = document.getElementById("adr-login-email");
    var codeInput = document.getElementById("adr-login-code");
    var msg = document.getElementById("adr-login-msg");
    if (step1) step1.style.display = "block";
    if (step2) step2.style.display = "none";
    if (emailInput) emailInput.value = "";
    if (codeInput) codeInput.value = "";
    if (msg) { msg.textContent = ""; msg.style.color = "#e63946"; }
  }

  /* 发送验证码 */
  window.adrSendCode = async function () {
    var input = document.getElementById("adr-login-email");
    var msg = document.getElementById("adr-login-msg");
    var btn = document.getElementById("adr-login-submit");
    var email = (input ? input.value : "").trim();
    if (!email || email.indexOf("@") < 0) {
      if (msg) msg.textContent = "请输入有效的邮箱地址";
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "发送中..."; }
    if (msg) msg.textContent = "";

    var res = await sb.auth.signInWithOtp({ email: email });

    if (btn) { btn.disabled = false; btn.textContent = "发送验证码"; }

    if (res.error) {
      if (msg) msg.textContent = "发送失败：" + res.error.message;
    } else {
      loginEmail = email;
      /* 切换到验证码输入步骤 */
      var step1 = document.getElementById("adr-login-step1");
      var step2 = document.getElementById("adr-login-step2");
      if (step1) step1.style.display = "none";
      if (step2) step2.style.display = "block";
      if (msg) { msg.style.color = "#1677ff"; msg.textContent = "验证码已发送到 " + email; }
      var codeInput = document.getElementById("adr-login-code");
      if (codeInput) codeInput.focus();
    }
  };

  /* 验证验证码并登录 */
  window.adrVerifyCode = async function () {
    var codeInput = document.getElementById("adr-login-code");
    var msg = document.getElementById("adr-login-msg");
    var btn = document.getElementById("adr-login-verify");
    var code = (codeInput ? codeInput.value : "").trim();
    if (!code || code.length < 4) {
      if (msg) msg.textContent = "请输入验证码";
      return;
    }
    if (!loginEmail) {
      if (msg) msg.textContent = "请先发送验证码";
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "验证中..."; }

    var res = await sb.auth.verifyOtp({
      email: loginEmail,
      token: code,
      type: "email"
    });

    if (btn) { btn.disabled = false; btn.textContent = "确认登录"; }

    if (res.error) {
      if (msg) { msg.style.color = "#e63946"; msg.textContent = "验证失败：" + res.error.message; }
    }
    /* 成功时 onAuthStateChange 会自动处理 */
  };

  /* 重新发送验证码 */
  window.adrResendCode = async function () {
    if (!loginEmail) return;
    var msg = document.getElementById("adr-login-msg");
    var res = await sb.auth.signInWithOtp({ email: loginEmail });
    if (res.error) {
      if (msg) { msg.style.color = "#e63946"; msg.textContent = "发送失败：" + res.error.message; }
    } else {
      if (msg) { msg.style.color = "#1677ff"; msg.textContent = "新验证码已发送，请查收"; }
    }
  };

  /* 登出 */
  window.adrLogout = async function () {
    await sb.auth.signOut();
    currentUser = null;
    cache = [];
    localSave([]);
    updateAuthUi();
    refreshAll();
    /* 如果在收藏夹页面，显示提示 */
    var list = document.getElementById("fav-list");
    if (list) {
      list.innerHTML = '<p style="color:#8a919c;font-size:14px;margin:12px 0">已登出。请重新登录以查看收藏。</p>';
    }
  };

  /* 监听认证状态变化 */
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_IN" && session && session.user) {
      currentUser = session.user;
      updateAuthUi();
      hideLoginModal();
      cloudLoad().then(function () {
        migrateLocal();
        /* 如果有待收藏项，自动收藏 */
        if (pendingFav) {
          var fav = pendingFav;
          pendingFav = null;
          if (!isFav(fav.u)) {
            cache.push(fav);
            localSave(cache);
            refreshAll();
            cloudAdd(fav);
          }
        }
      });
    }
  });

  /* ── 从云端加载 ── */
  async function cloudLoad() {
    if (!isLoggedIn()) {
      cache = localLoad();
      refreshAll();
      return;
    }
    try {
      var res = await sb.from("favorites").select("*").order("created_at", { ascending: false });
      if (res.error) throw res.error;
      var favs = (res.data || []).map(rowToFav);
      cache = favs;
      localSave(favs);
      updateSyncStatus("已同步");
    } catch (e) {
      console.warn("cloud load failed, using cache:", e);
      cache = localLoad();
      updateSyncStatus("离线模式（本地缓存）");
    }
    refreshAll();
  }

  /* ── 云端添加收藏 ── */
  async function cloudAdd(fav) {
    if (!isLoggedIn()) return;
    try {
      var row = favToRow(fav, currentUser.id);
      var res = await sb.from("favorites").upsert(row, { onConflict: "url,user_id" });
      if (res.error) throw res.error;
      updateSyncStatus("已同步");
    } catch (e) {
      console.warn("cloud add failed:", e);
      updateSyncStatus("同步失败，稍后重试");
    }
  }

  /* ── 云端删除收藏 ── */
  async function cloudRemove(url) {
    if (!isLoggedIn()) return;
    try {
      var res = await sb.from("favorites").delete().eq("url", url).eq("user_id", currentUser.id);
      if (res.error) throw res.error;
      updateSyncStatus("已同步");
    } catch (e) {
      console.warn("cloud remove failed:", e);
      updateSyncStatus("同步失败，稍后重试");
    }
  }

  /* ── 迁移 localStorage 旧数据到云端 ── */
  async function migrateLocal() {
    if (!isLoggedIn()) return;
    var oldFavs = localLoad();
    if (!oldFavs.length) return;
    var cloudUrls = {};
    cache.forEach(function (f) { cloudUrls[f.u] = true; });
    var toUpload = oldFavs.filter(function (f) { return !cloudUrls[f.u]; });
    if (!toUpload.length) return;
    for (var i = 0; i < toUpload.length; i++) {
      await cloudAdd(toUpload[i]);
    }
    await cloudLoad();
  }

  /* ── 核心逻辑 ── */
  function load() { return cache.slice(); }
  function isFav(u) {
    for (var i = 0; i < cache.length; i++) if (cache[i].u === u) return true;
    return false;
  }

  function refreshAll() {
    refreshButtons();
    renderFavPage();
    markAlreadyFav();
  }

  function updateSyncStatus(msg) {
    var el = document.getElementById("fav-sync-status");
    if (el) el.textContent = msg;
  }

  function refreshButtons() {
    var btns = document.querySelectorAll(".fav-btn");
    for (var i = 0; i < btns.length; i++) {
      var on = isFav(btns[i].getAttribute("data-u"));
      btns[i].textContent = on ? "★" : "☆";
      btns[i].className = on ? "fav-btn on" : "fav-btn";
      btns[i].title = on ? "取消收藏" : (isLoggedIn() ? "收藏" : "登录后收藏");
    }
    var chip = document.getElementById("fav-chip");
    if (chip) chip.textContent = cache.length;
  }

  function markAlreadyFav() {
    var cards = document.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var btn = cards[i].querySelector(".fav-btn");
      if (!btn) continue;
      var url = btn.getAttribute("data-u");
      var header = cards[i].querySelector("h2");
      if (!header) continue;
      var existing = header.querySelector(".already-fav");
      if (isFav(url)) {
        if (!existing) {
          var tag = document.createElement("span");
          tag.className = "already-fav";
          tag.textContent = "已收藏";
          header.appendChild(tag);
        }
      } else if (existing) {
        existing.remove();
      }
    }
  }

  /* ── 收藏按钮点击 ── */
  document.addEventListener("click", function (ev) {
    var b = ev.target;
    if (!b.classList || !b.classList.contains("fav-btn")) return;
    var u = b.getAttribute("data-u");

    if (isFav(u)) {
      /* 取消收藏 */
      cache = cache.filter(function (f) { return f.u !== u; });
      localSave(cache);
      refreshAll();
      cloudRemove(u);
    } else {
      /* 收藏 → 需要先登录 */
      if (!isLoggedIn()) {
        pendingFav = { t: b.getAttribute("data-t"), u: u,
                       s: b.getAttribute("data-s"), d: b.getAttribute("data-d"),
                       b: b.getAttribute("data-b") };
        showLoginModal();
        return;
      }
      var fav = { t: b.getAttribute("data-t"), u: u,
                  s: b.getAttribute("data-s"), d: b.getAttribute("data-d"),
                  b: b.getAttribute("data-b") };
      cache.push(fav);
      localSave(cache);
      refreshAll();
      cloudAdd(fav);
    }
  });

  /* ── 筛选/排序 ── */
  var sortDesc = true;
  var filterDate = "";
  var filterFrom = "";
  var filterTo = "";

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

  /* ── 收藏夹页面渲染 ── */
  function renderFavPage() {
    var list = document.getElementById("fav-list");
    if (!list) return;
    if (!isLoggedIn()) {
      list.innerHTML = '<p style="color:#8a919c;font-size:14px;margin:12px 0">请先登录查看收藏。</p>';
      document.getElementById("fav-count") && (document.getElementById("fav-count").textContent = "");
      return;
    }
    var favs = load();
    var q = (document.getElementById("fav-q").value || "").toLowerCase();
    var items = favs.filter(function (f) {
      if (q && ((f.t || "") + " " + (f.b || "") + " " + (f.s || "")).toLowerCase().indexOf(q) < 0) return false;
      var d = f.d || "";
      if (filterDate && d !== filterDate) return false;
      if (filterFrom && d < filterFrom) return false;
      if (filterTo && d > filterTo) return false;
      return true;
    });
    items.sort(function (a, b) {
      var c = (a.d || "").localeCompare(b.d || "") || (a.t || "").localeCompare(b.t || "");
      return sortDesc ? -c : c;
    });
    document.getElementById("fav-sort").textContent = sortDesc ? "按日期：新 → 旧" : "按日期：旧 → 新";
    document.getElementById("fav-count").textContent = "共 " + favs.length + " 条收藏" + (q ? "，匹配 " + items.length + " 条" : "");
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
      a.href = f.u; a.target = "_blank"; a.rel = "noopener";
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
      list.appendChild(card);
    });
  }

  window.adrExport = function () {
    var data = JSON.stringify(load(), null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ai-daily-radar-favorites.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ── 初始化 ── */
  document.addEventListener("DOMContentLoaded", async function () {
    /* 检查登录状态 */
    await checkAuth();

    refreshButtons();
    renderFavPage();
    markAlreadyFav();
    var q = document.getElementById("fav-q");
    if (q) q.addEventListener("input", renderFavPage);

    /* 已登录则加载云端数据 */
    if (isLoggedIn()) {
      await cloudLoad();
      await migrateLocal();
    } else {
      cache = localLoad();
      refreshAll();
    }
  });

  /* ── 时段 AI 分析 ── */
  var EDGE_FUNCTION_URL = SUPABASE_URL + "/functions/v1/analyze-range";

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
    if (resultDiv) resultDiv.innerHTML = '<p style="color:#1677ff">🔄 正在分析 ' + startDate + ' 至 ' + endDate + ' 的数据，请稍候（约 10-30 秒）...</p>';

    try {
      var res = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + SUPABASE_KEY
        },
        body: JSON.stringify({ start_date: startDate, end_date: endDate })
      });

      var data = await res.json();

      if (btn) { btn.disabled = false; btn.textContent = "开始 AI 分析"; }

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
      if (resultDiv) resultDiv.innerHTML = '<p style="color:#e63946">请求失败：' + e.message + '</p>';
    }
  };

  /* 简单的 Markdown 渲染 */
  function renderMarkdown(text) {
    return text
      .replace(/^## (.+)$/gm, '<h3 style="color:#203a43;margin:20px 0 10px;font-size:18px;border-left:4px solid #1677ff;padding-left:10px">$1</h3>')
      .replace(/^### (.+)$/gm, '<h4 style="color:#2c5364;margin:16px 0 8px;font-size:16px">$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li style="margin:4px 0;margin-left:20px">$1</li>')
      .replace(/

/g, '<br><br>')
      .replace(/
/g, '<br>');
  }
})();

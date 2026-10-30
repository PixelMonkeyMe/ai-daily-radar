(function () {
  /* ── Supabase 配置 ── */
  var SUPABASE_URL = "https://bvhzexdluniqdwmsxaxw.supabase.co";
  var SUPABASE_KEY = "sb_publishable_ZkAEga1YBOmfUrFba7yFYQ_5gt4kkMj";
  var _noop = function () { return Promise.resolve({ data: null, error: null }); };
  var sb;
  try {
    if (window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
      throw new Error("supabase-js not loaded");
    }
  } catch (e) {
    console.warn("Supabase init failed, favorites will work in local-only mode:", e);
    sb = { auth: { getSession: _noop, signInWithOtp: _noop, signInWithPassword: _noop, verifyOtp: _noop, signOut: _noop, refreshSession: _noop, resetPasswordForEmail: _noop, onAuthStateChange: function () { return { data: { subscription: { unsubscribe: _noop } } }; } }, from: function () { return { select: _noop, upsert: _noop, delete: function () { return { eq: _noop }; } }; } };
  }

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
    /* 始终用 autoCategorize 计算分类，不依赖数据库默认值（旧数据全是 '行业趋势'） */
    return { u: r.url, t: r.title || "", s: r.source || "", d: r.date || "", b: r.brief || "", c: autoCategorize(r.source || "", r.title || "", r.brief || ""), m: r.maturity || "", context_tags: r.context_tags || "", context_note: r.context_note || "" };
  }
  function favToRow(f, userId) {
    var cat = f.c || autoCategorize(f.s || "", f.t || "", f.b || "");
    return { url: f.u, title: f.t || "", source: f.s || "", date: f.d || "", brief: f.b || "", category: cat, maturity: f.m || "", context_tags: f.context_tags || "", context_note: f.context_note || "", user_id: userId };
  }

  /* ── AI 自动分类 ── */
  var CATEGORIES = [
    { name: "工具/框架", icon: "🔧", kw: ["github","框架","工具","sdk","cli","部署","开源","库","plugin","插件","vscode","docker","api","前端","后端","web"] },
    { name: "模型/算法", icon: "🤖", kw: ["模型","llm","算法","huggingface","推理","训练","fine-tun","gpt","transformer","embedding","量化","蒸馏","token"] },
    { name: "灵感/案例", icon: "💡", kw: ["product hunt","案例","应用","产品","创意","设计","灵感","project","产品"] },
    { name: "学习/方法", icon: "📚", kw: ["教程","方法","论文","研究","评测","学术","benchmark","survey","指南","课程","学习","arxiv"] }
  ];
  function autoCategorize(source, title, brief) {
    var text = (source + " " + title + " " + brief).toLowerCase();
    var scores = {};
    CATEGORIES.forEach(function (cat) {
      scores[cat.name] = 0;
      cat.kw.forEach(function (kw) {
        if (text.indexOf(kw) >= 0) scores[cat.name]++;
      });
    });
    var best = "行业趋势", bestScore = 0;
    for (var name in scores) {
      if (scores[name] > bestScore) { bestScore = scores[name]; best = name; }
    }
    return best;
  }
  function getCategoryInfo(name) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].name === name) return CATEGORIES[i];
    }
    return { name: "行业趋势", icon: "📊", kw: [] };
  }

  /* ── 认证相关 ── */
  function isLoggedIn() { return !!currentUser; }

  async function checkAuth() {
    try {
      // 优先从本地存储恢复 session
      var sessionRes = await sb.auth.getSession();
      if (sessionRes.data && sessionRes.data.session) {
        currentUser = sessionRes.data.session.user;
        // 如果 session 即将过期（5分钟内），尝试刷新
        var expiresAt = sessionRes.data.session.expires_at;
        var now = Math.floor(Date.now() / 1000);
        if (expiresAt && (expiresAt - now) < 300) {
          var refreshRes = await sb.auth.refreshSession();
          if (refreshRes.data && refreshRes.data.session) {
            currentUser = refreshRes.data.session.user;
          }
        }
      } else {
        currentUser = null;
      }
    } catch (e) {
      console.warn('checkAuth error:', e);
      currentUser = null;
    }
    updateAuthUi();
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
    var emailPwInput = document.getElementById("adr-login-email-pw");
    var pwInput = document.getElementById("adr-login-password");
    var codeInput = document.getElementById("adr-login-code");
    var msg = document.getElementById("adr-login-msg");
    var forgotSection = document.getElementById("adr-forgot-section");
    var pwTab = document.getElementById("adr-login-password-tab");
    var otpTab = document.getElementById("adr-login-otp-tab");
    var tabPw = document.getElementById("adr-tab-password");
    var tabOtp = document.getElementById("adr-tab-otp");
    if (step1) step1.style.display = "block";
    if (step2) step2.style.display = "none";
    if (emailInput) emailInput.value = "";
    if (emailPwInput) emailPwInput.value = "";
    if (pwInput) pwInput.value = "";
    if (codeInput) codeInput.value = "";
    if (msg) { msg.textContent = ""; msg.style.color = "#e63946"; }
    if (forgotSection) forgotSection.style.display = "none";
    if (pwTab) pwTab.style.display = "block";
    if (otpTab) otpTab.style.display = "none";
    if (tabPw) tabPw.className = "adr-auth-tab active";
    if (tabOtp) tabOtp.className = "adr-auth-tab";
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

  /* 切换登录 tab */
  window.adrSwitchTab = function (tab) {
    var pwTabBtn = document.getElementById("adr-tab-password");
    var otpTabBtn = document.getElementById("adr-tab-otp");
    var pwSection = document.getElementById("adr-login-password-tab");
    var otpSection = document.getElementById("adr-login-otp-tab");
    var forgotSection = document.getElementById("adr-forgot-section");
    var msg = document.getElementById("adr-login-msg");
    if (msg) msg.textContent = "";
    if (forgotSection) forgotSection.style.display = "none";
    if (tab === "password") {
      if (pwTabBtn) pwTabBtn.className = "adr-auth-tab active";
      if (otpTabBtn) otpTabBtn.className = "adr-auth-tab";
      if (pwSection) pwSection.style.display = "block";
      if (otpSection) otpSection.style.display = "none";
    } else {
      if (otpTabBtn) otpTabBtn.className = "adr-auth-tab active";
      if (pwTabBtn) pwTabBtn.className = "adr-auth-tab";
      if (otpSection) otpSection.style.display = "block";
      if (pwSection) pwSection.style.display = "none";
    }
  };

  /* 密码登录 */
  window.adrLoginWithPassword = async function () {
    var emailInput = document.getElementById("adr-login-email-pw");
    var pwInput = document.getElementById("adr-login-password");
    var msg = document.getElementById("adr-login-msg");
    var btn = document.getElementById("adr-login-pw-btn");
    var email = (emailInput ? emailInput.value : "").trim();
    var password = pwInput ? pwInput.value : "";
    if (!email || email.indexOf("@") < 0) {
      if (msg) msg.textContent = "请输入有效的邮箱地址";
      return;
    }
    if (!password) {
      if (msg) msg.textContent = "请输入密码";
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "登录中..."; }
    if (msg) msg.textContent = "";

    var res = await sb.auth.signInWithPassword({ email: email, password: password });

    if (btn) { btn.disabled = false; btn.textContent = "登录"; }

    if (res.error) {
      if (msg) { msg.style.color = "#e63946"; msg.textContent = "登录失败：" + res.error.message; }
    }
    /* 成功时 onAuthStateChange 会自动处理 */
  };

  /* 忘记密码 — 显示重置区 */
  window.adrShowForgotPassword = function () {
    var pwTab = document.getElementById("adr-login-password-tab");
    var otpTab = document.getElementById("adr-login-otp-tab");
    var forgotSection = document.getElementById("adr-forgot-section");
    var msg = document.getElementById("adr-login-msg");
    if (pwTab) pwTab.style.display = "none";
    if (otpTab) otpTab.style.display = "none";
    if (forgotSection) forgotSection.style.display = "block";
    if (msg) msg.textContent = "";
  };

  /* 忘记密码 — 返回登录 */
  window.adrBackToLogin = function () {
    var pwTab = document.getElementById("adr-login-password-tab");
    var forgotSection = document.getElementById("adr-forgot-section");
    var msg = document.getElementById("adr-login-msg");
    if (pwTab) pwTab.style.display = "block";
    if (forgotSection) forgotSection.style.display = "none";
    if (msg) msg.textContent = "";
  };

  /* 忘记密码 — 发送重置链接 */
  window.adrSendPasswordReset = async function () {
    var emailInput = document.getElementById("adr-forgot-email");
    var msg = document.getElementById("adr-login-msg");
    var btn = document.getElementById("adr-forgot-btn");
    var email = (emailInput ? emailInput.value : "").trim();
    if (!email || email.indexOf("@") < 0) {
      if (msg) msg.textContent = "请输入有效的邮箱地址";
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "发送中..."; }
    if (msg) msg.textContent = "";

    var res = await sb.auth.resetPasswordForEmail(email);

    if (btn) { btn.disabled = false; btn.textContent = "发送重置链接"; }

    if (res.error) {
      if (msg) { msg.style.color = "#e63946"; msg.textContent = "发送失败：" + res.error.message; }
    } else {
      if (msg) { msg.style.color = "#1677ff"; msg.textContent = "重置链接已发送至 " + email + "，请查收邮件"; }
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
      /* 云端有数据才覆盖本地；云端为空时保留本地缓存（可能是 RLS 权限问题或写入延迟） */
      if (favs.length > 0) {
        cache = favs;
        localSave(favs);
        updateSyncStatus("已同步");
      } else {
        /* 云端为空，尝试用本地数据 */
        var local = localLoad();
        if (local.length > 0) {
          cache = local;
          updateSyncStatus("本地缓存（云端同步中…）");
          /* 尝试将本地数据补传到云端 */
          migrateLocal();
        } else {
          cache = [];
          updateSyncStatus("已同步（暂无收藏）");
        }
      }
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
      var res = await sb.from("favorites").insert(row);
      if (res.error) throw res.error;
      updateSyncStatus("已同步");
    } catch (e) {
      console.error("cloud add failed:", e);
      updateSyncStatus("❌ 同步失败：" + (e.message || "请检查数据库权限"));
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
      console.error("cloud remove failed:", e);
      updateSyncStatus("❌ 同步失败：" + (e.message || "请检查数据库权限"));
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
      var on = isLoggedIn() && isFav(btns[i].getAttribute("data-u"));
      btns[i].textContent = on ? "★" : "☆";
      btns[i].className = on ? "fav-btn on" : "fav-btn";
      btns[i].title = on ? "取消收藏" : (isLoggedIn() ? "收藏" : "登录后收藏");
    }
    var chip = document.getElementById("fav-chip");
    if (chip) chip.textContent = isLoggedIn() ? cache.length : "0";
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
      if (isLoggedIn() && isFav(url)) {
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

  /* ── 拦截未登录用户点击收藏夹链接 ── */
  document.addEventListener("click", function (ev) {
    var el = ev.target;
    /* 向上查找最近的 <a> 标签 */
    while (el && el.tagName !== "A") el = el.parentElement;
    if (!el) return;
    var href = el.getAttribute("href") || "";
    /* 匹配 favorites.html 结尾的链接 */
    if (/favorites\.html(\#.*)?$/.test(href) && !isLoggedIn()) {
      ev.preventDefault();
      showLoginModal();
    }
  });

  /* ── 收藏按钮点击 ── */
  document.addEventListener("click", function (ev) {
    var b = ev.target;
    if (!b.classList || !b.classList.contains("fav-btn")) return;
    var u = b.getAttribute("data-u");

    var _t = b.getAttribute("data-t"), _s = b.getAttribute("data-s"),
        _d = b.getAttribute("data-d"), _b = b.getAttribute("data-b");
    var _c = autoCategorize(_s || "", _t || "", _b || "");

    /* 未登录 → 一律弹登录弹窗 */
    if (!isLoggedIn()) {
      pendingFav = { t: _t, u: u, s: _s, d: _d, b: _b, c: _c };
      showLoginModal();
      return;
    }

    if (isFav(u)) {
      /* 取消收藏 */
      cache = cache.filter(function (f) { return f.u !== u; });
      localSave(cache);
      refreshAll();
      cloudRemove(u);
    } else {
      /* 收藏 */
      var fav = { t: _t, u: u, s: _s, d: _d, b: _b, c: _c };
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
    if (!isLoggedIn()) {
      list.innerHTML = '<p style="color:#8a919c;font-size:14px;margin:12px 0">请先登录查看收藏。</p>';
      document.getElementById("fav-count") && (document.getElementById("fav-count").textContent = "");
      renderCategoryTabs([]);
      return;
    }
    var favs = load();
    /* 确保每条收藏都有分类（兼容旧数据） */
    favs.forEach(function (f) {
      if (!f.c) f.c = autoCategorize(f.s || "", f.t || "", f.b || "");
    });
    /* 渲染分类 tab */
    renderCategoryTabs(favs);
    var q = (document.getElementById("fav-q").value || "").toLowerCase();
    var items = favs.filter(function (f) {
      if (q && ((f.t || "") + " " + (f.b || "") + " " + (f.s || "")).toLowerCase().indexOf(q) < 0) return false;
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
      var catInfo = getCategoryInfo(f.c || "行业趋势");
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
    CATEGORIES.forEach(function (cat) { counts[cat.name] = 0; });
    counts["行业趋势"] = 0;
    favs.forEach(function (f) {
      var c = f.c || "行业趋势";
      counts[c] = (counts[c] || 0) + 1;
    });
    var html = "";
    var allActive = filterCategory === "" ? " style=\"background:#1677ff;color:#fff\"" : "";
    html += '<button class="fav-cat-tab" onclick="adrFilterCategory(\'\')"' + allActive + ' style="padding:4px 12px;border:1px solid #d9dde3;border-radius:16px;font-size:13px;cursor:pointer;margin:2px;background:' + (filterCategory === "" ? "#1677ff" : "#fff") + ';color:' + (filterCategory === "" ? "#fff" : "#333") + '">全部(' + counts["全部"] + ')</button>';
    CATEGORIES.forEach(function (cat) {
      var active = filterCategory === cat.name;
      html += '<button class="fav-cat-tab" onclick="adrFilterCategory(\'' + cat.name + '\')" style="padding:4px 12px;border:1px solid #d9dde3;border-radius:16px;font-size:13px;cursor:pointer;margin:2px;background:' + (active ? "#1677ff" : "#fff") + ';color:' + (active ? "#fff" : "#333") + '">' + cat.icon + ' ' + cat.name + '(' + (counts[cat.name] || 0) + ')</button>';
    });
    /* 行业趋势（不在 CATEGORIES 数组里的默认分类） */
    var trendActive = filterCategory === "行业趋势";
    html += '<button class="fav-cat-tab" onclick="adrFilterCategory(\'行业趋势\')" style="padding:4px 12px;border:1px solid #d9dde3;border-radius:16px;font-size:13px;cursor:pointer;margin:2px;background:' + (trendActive ? "#1677ff" : "#fff") + ';color:' + (trendActive ? "#fff" : "#333") + '">📊 行业趋势(' + (counts["行业趋势"] || 0) + ')</button>';
    container.innerHTML = html;
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

  /* ── "日报首页"链接修正：从归档页进入收藏夹时，返回该归档页而非当天日报 ── */
  (function () {
    var homeLink = document.getElementById("adr-home-link");
    if (homeLink) {
      var lastReport = sessionStorage.getItem("adr_report");
      if (lastReport) {
        homeLink.href = lastReport;
      }
    }
  })();

  /* ── 初始化 ── */
  document.addEventListener("DOMContentLoaded", async function () {
    /* 检查登录状态 */
    await checkAuth();

    refreshButtons();
    renderFavPage();
    markAlreadyFav();
    var q = document.getElementById("fav-q");
    if (q) {
      /* 搜索框初始 readonly 防浏览器自动填充，2 秒后解除 */
      setTimeout(function () { q.removeAttribute("readonly"); }, 2000);
      q.addEventListener("input", renderFavPage);
    }

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
          "Authorization": "Bearer " + SUPABASE_KEY
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

  /* ── 上下文编辑对话框 ── */
  var CONTEXT_TAGS = ["技术选型", "趋势判断", "风险评估", "预算申请"];

  function showContextEditDialog(fav) {
    // 创建遮罩层
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center";
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    // 创建对话框
    var dialog = document.createElement("div");
    dialog.style.cssText = "background:#fff;border-radius:8px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.15)";

    var html = '<h3 style="margin:0 0 16px;font-size:18px;color:#203a43">✏️ 编辑收藏上下文</h3>';
    html += '<p style="color:#8a919c;font-size:12px;margin-bottom:16px">💡 上下文用于后续生成会议弹药包，仅自己可见</p>';

    // 标签选择
    html += '<div style="margin-bottom:16px">';
    html += '<label style="display:block;font-size:14px;font-weight:600;margin-bottom:8px">场景标签（可多选）</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    var currentTags = fav.context_tags ? fav.context_tags.split(',').filter(function(t) { return t.trim(); }) : [];
    CONTEXT_TAGS.forEach(function(tag) {
      var checked = currentTags.indexOf(tag) >= 0 ? 'checked' : '';
      html += '<label style="display:flex;align-items:center;gap:4px;background:#f5f5f5;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px">';
      html += '<input type="checkbox" value="' + tag + '" ' + checked + ' style="margin:0"> ' + tag + '</label>';
    });
    html += '</div></div>';

    // 备注输入
    html += '<div style="margin-bottom:16px">';
    html += '<label style="display:block;font-size:14px;font-weight:600;margin-bottom:8px">备注</label>';
    var noteValue = fav.context_note || "";
    html += '<textarea id="ctx-note-input" style="width:100%;min-height:80px;padding:8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;resize:vertical" placeholder="为什么收藏？计划用在什么场景？">' + noteValue.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>';
    html += '</div>';

    // 按钮
    html += '<div style="display:flex;gap:8px;justify-content:flex-end">';
    html += '<button id="ctx-cancel-btn" style="background:#fff;border:1px solid #d9d9d9;border-radius:4px;padding:8px 16px;font-size:14px;cursor:pointer">取消</button>';
    html += '<button id="ctx-save-btn" style="background:#1677ff;color:#fff;border:none;border-radius:4px;padding:8px 16px;font-size:14px;cursor:pointer">保存</button>';
    html += '</div>';

    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 绑定事件
    document.getElementById("ctx-cancel-btn").onclick = function() { overlay.remove(); };
    document.getElementById("ctx-save-btn").onclick = function() {
      // 收集选中的标签
      var checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
      var selectedTags = [];
      checkboxes.forEach(function(cb) { if (cb.checked) selectedTags.push(cb.value); });
      // 获取备注
      var note = document.getElementById("ctx-note-input").value.trim();
      // 更新收藏
      updateFavoriteContext(fav, selectedTags.join(','), note, function() {
        overlay.remove();
        renderFavPage(); // 重新渲染
      });
    };
  }

  function updateFavoriteContext(fav, tags, note, callback) {
    // 更新本地缓存
    var favs = localLoad();
    favs.forEach(function(f) {
      if (f.t === fav.t && f.u === fav.u) {
        f.context_tags = tags;
        f.context_note = note;
      }
    });
    localSave(favs);

    // 同步到云端
    if (isLoggedIn() && currentUser) {
      var row = favToRow({ u: fav.u, t: fav.t, s: fav.s, d: fav.d, b: fav.b, c: fav.c, m: fav.m, context_tags: tags, context_note: note }, currentUser.id);
      sb.from("favorites").upsert(row).then(function(res) {
        if (res.error) {
          console.warn("同步上下文失败:", res.error);
          showContextToast("❌ 保存失败：" + res.error.message);
        } else {
          showContextToast("✅ 备注已保存");
        }
        if (callback) callback();
      });
    } else {
      showContextToast("✅ 备注已保存（本地）");
      if (callback) callback();
    }
  }

  // Toast 提示函数
  function showContextToast(message) {
    // 移除已有的 toast
    var existing = document.getElementById("context-toast");
    if (existing) existing.remove();

    // 创建新 toast
    var toast = document.createElement("div");
    toast.id = "context-toast";
    toast.textContent = message;
    toast.style.cssText = "position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:slideIn 0.3s ease";
    document.body.appendChild(toast);

    // 3 秒后自动消失
    setTimeout(function() {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  /* ── 初始化：版本号防缓存 ── */
  console.log("fav.js v3.3a loaded");
})();

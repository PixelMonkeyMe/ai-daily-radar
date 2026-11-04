/* fav-core.js —— 配置/工具/分类/认证/云端/收藏核心/上下文编辑（由 fav.js 拆分，评审方案 v2）
   依赖: 无。消费方: 全部页面。API 见底部 window.ADR；可变状态（sb/cache/currentUser 等）为模块私有。 */
(function () {
  /* ── 版本号（唯一来源：升级 fav.js 时只改这里，build_site.py 构建时自动读取注入缓存破坏参数） ── */
  var APP_VERSION = "3.3d-3";

  /* ── Supabase 配置 ── */
  var SUPABASE_URL = "https://bvhzexdluniqdwmsxaxw.supabase.co";
  var SUPABASE_KEY = "sb_publishable_ZkAEga1YBOmfUrFba7yFYQ_5gt4kkMj";
  var _noop = function () { return Promise.resolve({ data: null, error: null }); };
  var sb;


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
    return {
      u: r.url,
      t: r.title || "",
      s: r.source || "",
      d: r.date || "",
      b: r.brief || "",
      c: autoCategorize(r.source || "", r.title || "", r.brief || ""),
      m: r.maturity || "",
      context_tags: r.context_tags || "",
      context_note: r.context_note || "",
      /* Phase 3.3c: 完整 AI 分析字段 */
      what: r.what || "",
      industry_use: r.industry_use || "",
      capability: r.capability || "",
      assessment: r.assessment || "",
      risk: r.risk || "",
      importance: r.importance || 3
    };
  }
  function favToRow(f, userId) {
    var cat = f.c || autoCategorize(f.s || "", f.t || "", f.b || "");
    return {
      url: f.u,
      title: f.t || "",
      source: f.s || "",
      date: f.d || "",
      brief: f.b || "",
      category: cat,
      maturity: f.m || "",
      context_tags: f.context_tags || "",
      context_note: f.context_note || "",
      /* Phase 3.3c: 完整 AI 分析字段 */
      what: f.what || "",
      industry_use: f.industry_use || "",
      capability: f.capability || "",
      assessment: f.assessment || "",
      risk: f.risk || "",
      importance: f.importance || 3,
      user_id: userId
    };
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

  /* 验证验证码并登录 */

  /* 重新发送验证码 */

  /* 切换登录 tab */

  /* 密码登录 */

  /* 忘记密码 — 显示重置区 */

  /* 忘记密码 — 返回登录 */

  /* 忘记密码 — 发送重置链接 */

  /* 登出 */

  /* 监听认证状态变化 */
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
    markAlreadyFav();
    /* renderFavPage 属 fav-page.js：事件通知替代直接调用（同步派发，时序不变） */
    document.dispatchEvent(new CustomEvent("favs:changed"));
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

  /* 历史懒加载片段注入后（history.js 派发），刷新新注入收藏按钮的 ☆/★ 初始态 */

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
  /* ── 上下文编辑对话框 ── */
  var CONTEXT_TAGS = ["技术选型", "趋势判断", "风险评估", "预算申请"];

  function showContextEditDialog(fav, isNew) {
    // 创建遮罩层 - 添加 autocomplete="off" 防止浏览器弹出密码保存
    var overlay = document.createElement("div");
    overlay.setAttribute("autocomplete", "off");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center";
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    // 创建对话框 - 添加 autocomplete="off" 防止浏览器弹出密码保存
    var dialog = document.createElement("div");
    dialog.setAttribute("autocomplete", "off");
    dialog.style.cssText = "background:#fff;border-radius:8px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.15)";

    var title = isNew ? "⭐ 收藏成功，补充上下文" : "✏️ 编辑收藏上下文";
    var html = '<h3 style="margin:0 0 16px;font-size:18px;color:#203a43">' + title + '</h3>';
    html += '<p style="color:#8a919c;font-size:12px;margin-bottom:16px">💡 上下文用于后续生成会议弹药包，仅自己可见</p>';

    // 标签选择
    html += '<div style="margin-bottom:16px">';
    html += '<label style="display:block;font-size:14px;font-weight:600;margin-bottom:8px">场景标签（可多选）</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    var currentTags = fav.context_tags ? fav.context_tags.split(',').filter(function(t) { return t.trim(); }) : [];
    CONTEXT_TAGS.forEach(function(tag) {
      var checked = currentTags.indexOf(tag) >= 0 ? 'checked' : '';
      html += '<label style="display:flex;align-items:center;gap:4px;background:#f5f5f5;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px">';
      html += '<input type="checkbox" value="' + tag + '" ' + checked + ' style="margin:0" autocomplete="off"> ' + tag + '</label>';
    });
    html += '</div></div>';

    // 备注输入
    html += '<div style="margin-bottom:16px">';
    html += '<label style="display:block;font-size:14px;font-weight:600;margin-bottom:8px">备注</label>';
    var noteValue = fav.context_note || "";
    html += '<textarea id="ctx-note-input" style="width:100%;min-height:80px;padding:8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;resize:vertical" placeholder="为什么收藏？计划用在什么场景？" autocomplete="off">' + noteValue.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>';
    html += '</div>';

    // 按钮
    html += '<div style="display:flex;gap:8px;justify-content:flex-end">';
    html += '<button id="ctx-cancel-btn" type="button" autocomplete="off" style="background:#fff;border:1px solid #d9d9d9;border-radius:4px;padding:8px 16px;font-size:14px;cursor:pointer">取消</button>';
    html += '<button id="ctx-save-btn" type="button" autocomplete="off" style="background:#1677ff;color:#fff;border:none;border-radius:4px;padding:8px 16px;font-size:14px;cursor:pointer">保存</button>';
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
    // 更新内存缓存（关键！renderFavPage 使用的是 cache 变量）
    cache.forEach(function(f) {
      if (f.t === fav.t && f.u === fav.u) {
        f.context_tags = tags;
        f.context_note = note;
      }
    });
    // 同步更新 localStorage
    localSave(cache);

    // 同步到云端
    if (isLoggedIn() && currentUser) {
      /* Phase 3.3d: 传入完整 fav（含 AI 分析字段），避免 upsert 把 what/industry_use 等重置为空 */
      var row = favToRow({
        u: fav.u, t: fav.t, s: fav.s, d: fav.d, b: fav.b, c: fav.c, m: fav.m,
        what: fav.what, industry_use: fav.industry_use, capability: fav.capability,
        assessment: fav.assessment, risk: fav.risk, importance: fav.importance,
        context_tags: tags, context_note: note
      }, currentUser.id);
      // 使用 onConflict 指定唯一约束列，避免 duplicate key 错误
      sb.from("favorites").upsert(row, { onConflict: 'url' }).then(function(res) {
        if (res.error) {
          console.warn("同步上下文失败:", res.error);
          showContextToast("❌ 同步失败：" + res.error.message);
        } else {
          showContextToast("✅ 备注已保存");
        }
        document.dispatchEvent(new CustomEvent("favs:changed"));
        if (callback) callback();
      });
    } else {
      showContextToast("✅ 备注已保存（本地）");
      document.dispatchEvent(new CustomEvent("favs:changed"));
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

  /* ── 初始化（全部副作用收于此，Node require 时不执行） ── */
  function init() {
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
  window.adrBackToLogin = function () {
    var pwTab = document.getElementById("adr-login-password-tab");
    var forgotSection = document.getElementById("adr-forgot-section");
    var msg = document.getElementById("adr-login-msg");
    if (pwTab) pwTab.style.display = "block";
    if (forgotSection) forgotSection.style.display = "none";
    if (msg) msg.textContent = "";
  };
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
            /* Phase 3.3d: 登录后自动收藏也弹出上下文编辑 */
            showContextEditDialog(fav, true);
          }
        }
      });
    }
  });
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

    /* Phase 3.3c: 读取完整 AI 分析字段 */
    var _what = b.getAttribute("data-what") || "";
    var _industry_use = b.getAttribute("data-industry-use") || "";
    var _capability = b.getAttribute("data-capability") || "";
    var _assessment = b.getAttribute("data-assessment") || "";
    var _risk = b.getAttribute("data-risk") || "";
    var _importance = parseInt(b.getAttribute("data-importance")) || 3;

    /* 未登录 → 一律弹登录弹窗 */
    if (!isLoggedIn()) {
      pendingFav = {
        t: _t, u: u, s: _s, d: _d, b: _b, c: _c,
        what: _what, industry_use: _industry_use, capability: _capability,
        assessment: _assessment, risk: _risk, importance: _importance
      };
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
      var fav = {
        t: _t, u: u, s: _s, d: _d, b: _b, c: _c,
        what: _what, industry_use: _industry_use, capability: _capability,
        assessment: _assessment, risk: _risk, importance: _importance
      };
      cache.push(fav);
      localSave(cache);
      refreshAll();
      cloudAdd(fav);
      /* Phase 3.3d: 收藏当下立即弹出上下文编辑（记忆最完整，免去到收藏夹补录） */
      showContextEditDialog(fav, true);
    }
  });

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
    markAlreadyFav();
    document.dispatchEvent(new CustomEvent("favs:changed"));

    /* 已登录则加载云端数据 */
    if (isLoggedIn()) {
      await cloudLoad();
      await migrateLocal();
    } else {
      cache = localLoad();
      refreshAll();
    }
  });

  document.addEventListener("hist:loaded", refreshButtons);

  console.log("fav.js v" + APP_VERSION + " loaded");
  }


  /* ── UMD: Node require 仅取纯逻辑（零副作用）；浏览器挂 ADR 命名空间并执行 init ── */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { rowToFav: rowToFav, favToRow: favToRow, autoCategorize: autoCategorize,
                       localLoad: localLoad, localSave: localSave };
  } else {
    /* ADR 命名空间：只暴露函数与只读常量，可变状态留闭包（评审[阻塞]1） */
    window.ADR = {
      version: APP_VERSION,
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      isLoggedIn: isLoggedIn,
      load: load,
      isFav: isFav,
      autoCategorize: autoCategorize,
      getCategoryInfo: getCategoryInfo,
      CATEGORIES: CATEGORIES,
      updateSyncStatus: updateSyncStatus
    };
    init();
  }
})();


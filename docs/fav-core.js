/* fav-core.js —— 配置/工具/分类/认证/云端/收藏核心/上下文编辑（由 fav.js 拆分，评审方案 v2）
   依赖: 无。消费方: 全部页面。API 见底部 window.ADR；可变状态（sb/cache/currentUser 等）为模块私有。 */
(function () {
  /* ── 版本号（唯一来源：升级 fav.js 时只改这里，build_site.py 构建时自动读取注入缓存破坏参数） ── */
  var APP_VERSION = "3.3d-9";

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
    html += '<textarea id="ctx-note-input" style="width:100%;min-height:80px;padding:8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;resize:vertical" placeholder="为什么收藏？计划用在什么场景？（支持 Markdown：**加粗**、- 列表、> 引用、``` 代码）" autocomplete="off">' + noteValue.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>';
    html += '</div>';

    // 按钮
    html += '<div style="display:flex;gap:8px;justify-content:flex-end">';
    html += '<button id="ctx-cancel-btn" type="button" autocomplete="off" style="background:#fff;border:1px solid #d9d9d9;border-radius:4px;padding:8px 16px;font-size:14px;cursor:pointer">取消</button>';
    html += '<button id="ctx-save-btn" type="button" autocomplete="off" style="background:#1677ff;color:#fff;border:none;border-radius:4px;padding:8px 16px;font-size:14px;cursor:pointer">保存</button>';
    html += '</div>';

    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 粘贴整理（评审裁决：仅两条无损规则，代码块内容完全跳过）
    (function () {
      var ta = document.getElementById("ctx-note-input");
      if (!ta) return;
      ta.addEventListener("paste", function () {
        setTimeout(function () {
          var before = ta.value;
          if (before.length < 200 || before.indexOf("\n") < 0) return;
          var after = tidyNotePaste(before);
          if (after === before) return;
          ta.value = after;
          var tip = document.createElement("div");
          tip.className = "note-tidy-tip";
          tip.textContent = "已整理排版（压缩空行）· 撤销";
          tip.style.cssText = "margin-top:6px;font-size:12px;color:#8a919c;cursor:pointer;text-decoration:underline";
          tip.addEventListener("click", function () {
            ta.value = before;
            tip.remove();
          });
          ta.parentNode.insertBefore(tip, ta.nextSibling);
          setTimeout(function () { if (tip.parentNode) tip.remove(); }, 6000);
        }, 0);
      });
    })();

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
  /* ── 收藏卡片构建（收藏页与首页"我的标注"共享，评审通过方案）──
     仅在调用时访问 DOM，顶层零副作用；summary:// 按 data-page 能力分支 */
  function buildFavCard(f) {

    var card = document.createElement("div");
    card.className = "card";
    var h = document.createElement("h2");
    var a = document.createElement("a");
    /* summary:// 条目（今日总结）按页面能力分支（评审[阻塞]）：
       favorites 页 = 派发 summary:open 由 fav-page 弹窗；
       其他页面（无弹窗能力）= 纯文本标题 + 收藏夹回退链接，不留死链 */
    if (/^summary:\/\//.test(f.u)) {
      if (document.body.getAttribute("data-page") === "favorites") {
        a.href = "javascript:void(0)";
        a.style.cursor = "pointer";
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          document.dispatchEvent(new CustomEvent("summary:open",
            { detail: { id: f.u.replace("summary://", ""), title: f.t } }));
        });
      } else {
        a.removeAttribute("href");
        a.style.color = "inherit";
        var fb = document.createElement("a");
        fb.href = "favorites.html";
        fb.style.cssText = "font-size:12px;color:#8a919c;margin-left:8px";
        fb.textContent = "在收藏夹查看完整总结 →";
        h.appendChild(fb);
      }
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
      var labEl = document.createElement("div");
      labEl.className = "note-label";
      labEl.textContent = "我的备注";
      noteEl.appendChild(labEl);
      noteEl.appendChild(buildNoteBox(f.context_note, String(f.u || f.t || "note"),
                                      function () { showContextEditDialog(f); }));
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
    
    return card;
  }

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
    injectInlineNotes();
  });

  document.addEventListener("hist:loaded", refreshButtons);
  /* 备注原地展示：收藏变更 / 期次切换后刷新 */
  document.addEventListener("favs:changed", injectInlineNotes);
  document.addEventListener("hist:loaded", function () { setTimeout(injectInlineNotes, 0); });

  console.log("fav.js v" + APP_VERSION + " loaded");
  }


  /* ── 备注 Markdown 白名单渲染器（评审要求：DOM 构建，永不产生用户可控 HTML 字符串）──
     块级 6 种：围栏代码块 / 标题 / 引用 / 无序列表 / 有序列表 / 段落
     行内 2 种：**加粗** / `行内代码`；仅允许白名单元素，内容一律 textContent */
  function appendNoteInline(parent, text) {
    var s = String(text == null ? "" : text);
    var re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    var last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      var tok = m[0];
      if (tok.charAt(0) === "*") {
        var strong = document.createElement("strong");
        strong.textContent = tok.slice(2, -2);
        parent.appendChild(strong);
      } else {
        var code = document.createElement("code");
        code.className = "note-code";
        code.textContent = tok.slice(1, -1);
        parent.appendChild(code);
      }
      last = re.lastIndex;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }

  function renderNoteMd(text) {
    var frag = document.createDocumentFragment();
    var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      /* 围栏代码块：内部原样保留，不做任何语法解析 */
      if (/^\s*```/.test(line)) {
        var codeLines = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { codeLines.push(lines[i]); i++; }
        i++;
        var pre = document.createElement("pre");
        pre.className = "note-pre";
        var codeEl = document.createElement("code");
        codeEl.textContent = codeLines.join("\n");
        pre.appendChild(codeEl);
        frag.appendChild(pre);
        continue;
      }
      if (!line.trim()) { i++; continue; }
      /* 标题：所有层级压平成一级（不用 h1-h6，避免污染读屏大纲） */
      var hm = line.match(/^\s*#{1,6}\s+(.*)$/);
      if (hm) {
        var hp = document.createElement("p");
        hp.className = "note-h";
        appendNoteInline(hp, hm[1]);
        frag.appendChild(hp);
        i++; continue;
      }
      /* 引用 */
      if (/^\s*>\s?/.test(line)) {
        var qs = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          qs.push(lines[i].replace(/^\s*>\s?/, "")); i++;
        }
        var bq = document.createElement("blockquote");
        bq.className = "note-quote";
        appendNoteInline(bq, qs.join("\n"));
        frag.appendChild(bq);
        continue;
      }
      /* 无序列表 */
      if (/^\s*[-*+]\s+/.test(line)) {
        var ul = document.createElement("ul");
        ul.className = "note-ul";
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          var li = document.createElement("li");
          appendNoteInline(li, lines[i].replace(/^\s*[-*+]\s+/, "")); i++;
          ul.appendChild(li);
        }
        frag.appendChild(ul); continue;
      }
      /* 有序列表 */
      if (/^\s*\d+\.\s+/.test(line)) {
        var ol = document.createElement("ol");
        ol.className = "note-ol";
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          var li2 = document.createElement("li");
          appendNoteInline(li2, lines[i].replace(/^\s*\d+\.\s+/, "")); i++;
          ol.appendChild(li2);
        }
        frag.appendChild(ol); continue;
      }
      /* 段落：连续普通行合并 */
      var ps = [];
      while (i < lines.length && lines[i].trim() &&
             !/^\s*(```|#{1,6}\s|>|[-*+]\s|\d+\.\s)/.test(lines[i])) {
        ps.push(lines[i]); i++;
      }
      if (ps.length) {
        var p = document.createElement("p");
        p.className = "note-p";
        appendNoteInline(p, ps.join("\n"));
        frag.appendChild(p);
      } else { i++; }
    }
    return frag;
  }


  /* ── 备注折叠：按渲染后实测高度判断（评审：不用字数）──
     展开整页延展（不做内滚，避免手机手势冲突），收起时视口回到备注顶部 */
  var noteExpanded = {};   /* key -> true，内存记忆：切期保留、刷新重置 */

  function buildNoteBox(noteText, key, onEdit) {
    var text = String(noteText == null ? "" : noteText);
    var wrap = document.createElement("div");
    wrap.className = "note-wrap";

    var inner = document.createElement("div");
    inner.className = "note-md";
    inner.id = "note-md-" + key.replace(/[^a-zA-Z0-9_-]/g, "_");
    inner.appendChild(renderNoteMd(text));
    wrap.appendChild(inner);

    var bar = document.createElement("div");
    bar.className = "note-bar";
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "note-toggle";
    toggle.textContent = "展开全文 ▾";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", inner.id);
    bar.appendChild(toggle);

    var meta = document.createElement("span");
    meta.className = "note-meta";
    bar.appendChild(meta);

    if (onEdit) {
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "note-edit";
      editBtn.textContent = "编辑";
      editBtn.addEventListener("click", onEdit);
      bar.appendChild(editBtn);
    }
    wrap.appendChild(bar);

    function applyCollapsed(collapsed) {
      inner.classList.toggle("collapsed", collapsed);
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.textContent = collapsed ? "展开全文 ▾" : "收起 ▴";
      noteExpanded[key] = !collapsed;
    }

    /* 折叠态初值：默认收起，除非本次浏览内记过展开 */
    applyCollapsed(!noteExpanded[key]);

    /* 渲染后实测高度：超过 3 行才显示折叠控件 */
    window.requestAnimationFrame(function () {
      inner.classList.add("collapsed");
      var over = inner.scrollHeight > inner.clientHeight + 1;
      if (!over) {
        inner.classList.remove("collapsed");
        bar.style.display = "none";
        return;
      }
      meta.textContent = "约 " + text.length + " 字";
      bar.style.display = "flex";
      applyCollapsed(!noteExpanded[key]);
    });

    toggle.addEventListener("click", function () {
      var willExpand = inner.classList.contains("collapsed");
      applyCollapsed(!willExpand);
      if (!willExpand) {
        /* 收起：把备注顶部送回视口，否则按钮已滚出屏幕 */
        try { wrap.scrollIntoView({ block: "start", behavior: "auto" }); } catch (e) { wrap.scrollIntoView(); }
      }
    });

    return wrap;
  }


  /* ── 粘贴整理（保守两条无损规则，评审裁决）──
     1) 统一换行符  2) 代码块外 3+ 连续空行压成 1 个；代码块内容完全跳过 */
  function tidyNotePaste(text) {
    var s = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    var out = [], inFence = false, blanks = 0;
    s.split("\n").forEach(function (line) {
      if (/^\s*```/.test(line)) { inFence = !inFence; blanks = 0; out.push(line); return; }
      if (inFence) { out.push(line); return; }
      if (!line.trim()) {
        blanks++;
        if (blanks <= 1) out.push("");
        return;
      }
      blanks = 0;
      out.push(line.replace(/[ \t]+$/, ""));
    });
    return out.join("\n").replace(/^\n+|\n+$/g, "");
  }

  /* ── 备注原地展示：已收藏且有备注/标签的条目，在条目卡片下方直接显示 ──
     覆盖两处：当日卡片（h2 为容器）与历史期次片段（.item-line）。
     收藏页的 buildFavCard 已自带备注展示，此处跳过（存在 .context-note-display 即视为已有） */
  function removeInlineNote(host) {
    var old = host.querySelector(".inline-note");
    if (old) old.parentNode.removeChild(old);
  }

  function buildInlineNote(fav) {
    var box = document.createElement("div");
    box.className = "inline-note";

    var tags = String(fav.context_tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    if (tags.length) {
      var tw = document.createElement("div");
      tw.className = "inline-note-tags";
      tags.forEach(function (t) {
        var c = document.createElement("span");
        c.textContent = "#" + t;
        tw.appendChild(c);
      });
      box.appendChild(tw);
    }

    if (fav.context_note) {
      var lab = document.createElement("div");
      lab.className = "note-label";
      lab.textContent = "我的备注";
      box.appendChild(lab);
      box.appendChild(buildNoteBox(fav.context_note, String(fav.u || fav.t || "note"),
                                   function () { showContextEditDialog(fav); }));
    } else {
      var editSolo = document.createElement("button");
      editSolo.type = "button";
      editSolo.className = "inline-note-edit";
      editSolo.textContent = "编辑";
      editSolo.addEventListener("click", function () { showContextEditDialog(fav); });
      box.appendChild(editSolo);
    }

    return box;
  }

  function injectInlineNotes() {
    if (!isLoggedIn()) {
      Array.prototype.forEach.call(document.querySelectorAll(".inline-note"), function (n) { n.parentNode.removeChild(n); });
      return;
    }
    var byUrl = {};
    cache.forEach(function (f) { if (f && f.u) byUrl[f.u] = f; });

    Array.prototype.forEach.call(document.querySelectorAll(".fav-btn[data-u]"), function (btn) {
      var host = btn.closest(".item-line") || (btn.closest("h2") ? btn.closest("h2").parentElement : null);
      if (!host) return;
      if (host.querySelector(".context-note-display")) return;  /* 收藏页卡片已自带 */
      var fav = byUrl[btn.getAttribute("data-u")];
      var has = fav && ((typeof fav.context_note === "string" && fav.context_note.trim()) ||
                        String(fav.context_tags || "").split(",").some(function (t) { return t.trim(); }));
      removeInlineNote(host);
      if (has) host.appendChild(buildInlineNote(fav));
    });
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
      updateSyncStatus: updateSyncStatus,
      buildFavCard: buildFavCard
    };
    init();
  }
})();


(function () {
  /* ── Supabase 配置 ── */
  var SUPABASE_URL = "https://bvhzexdluniqdwmsxaxw.supabase.co";
  var SUPABASE_KEY = "sb_publishable_ZkAEga1YBOmfUrFba7yFYQ_5gt4kkMj";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var KEY = "adr_favs";       // localStorage 缓存键
  var cache = [];              // 内存缓存
  var synced = true;           // 同步状态

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
  function favToRow(f) {
    return { url: f.u, title: f.t || "", source: f.s || "", date: f.d || "", brief: f.b || "" };
  }

  /* ── 从云端加载 ── */
  async function cloudLoad() {
    try {
      var res = await sb.from("favorites").select("*").order("created_at", { ascending: false });
      if (res.error) throw res.error;
      var favs = (res.data || []).map(rowToFav);
      cache = favs;
      localSave(favs);
      synced = true;
      updateSyncStatus("已同步");
    } catch (e) {
      console.warn("cloud load failed, using cache:", e);
      cache = localLoad();
      synced = false;
      updateSyncStatus("离线模式（本地缓存）");
    }
    refreshAll();
  }

  /* ── 云端添加收藏 ── */
  async function cloudAdd(fav) {
    try {
      var row = favToRow(fav);
      var res = await sb.from("favorites").upsert(row, { onConflict: "url" });
      if (res.error) throw res.error;
      synced = true;
      updateSyncStatus("已同步");
    } catch (e) {
      console.warn("cloud add failed:", e);
      synced = false;
      updateSyncStatus("同步失败，稍后重试");
    }
  }

  /* ── 云端删除收藏 ── */
  async function cloudRemove(url) {
    try {
      var res = await sb.from("favorites").delete().eq("url", url);
      if (res.error) throw res.error;
      synced = true;
      updateSyncStatus("已同步");
    } catch (e) {
      console.warn("cloud remove failed:", e);
      synced = false;
      updateSyncStatus("同步失败，稍后重试");
    }
  }

  /* ── 迁移 localStorage 旧数据到云端 ── */
  async function migrateLocal() {
    var oldFavs = localLoad();
    if (!oldFavs.length) return;
    if (cache.length > 0) {
      var cloudUrls = {};
      cache.forEach(function (f) { cloudUrls[f.u] = true; });
      var toUpload = oldFavs.filter(function (f) { return !cloudUrls[f.u]; });
      if (!toUpload.length) return;
      for (var i = 0; i < toUpload.length; i++) {
        await cloudAdd(toUpload[i]);
      }
    } else {
      for (var i = 0; i < oldFavs.length; i++) {
        await cloudAdd(oldFavs[i]);
      }
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
      btns[i].title = on ? "取消收藏" : "收藏";
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

  document.addEventListener("click", function (ev) {
    var b = ev.target;
    if (!b.classList || !b.classList.contains("fav-btn")) return;
    var u = b.getAttribute("data-u");
    if (isFav(u)) {
      cache = cache.filter(function (f) { return f.u !== u; });
      localSave(cache);
      refreshAll();
      cloudRemove(u);
    } else {
      var fav = { t: b.getAttribute("data-t"), u: u,
                  s: b.getAttribute("data-s"), d: b.getAttribute("data-d"),
                  b: b.getAttribute("data-b") };
      cache.push(fav);
      localSave(cache);
      refreshAll();
      cloudAdd(fav);
    }
  });

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

  function renderFavPage() {
    var list = document.getElementById("fav-list");
    if (!list) return;
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

  document.addEventListener("DOMContentLoaded", function () {
    refreshButtons();
    renderFavPage();
    markAlreadyFav();
    var q = document.getElementById("fav-q");
    if (q) q.addEventListener("input", renderFavPage);
    cloudLoad().then(function () {
      migrateLocal();
    });
  });
})();

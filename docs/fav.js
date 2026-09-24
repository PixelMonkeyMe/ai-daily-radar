(function () {
  var KEY = "adr_favs";

  function enc(o) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(o))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function dec(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function isFav(u) {
    var favs = load();
    for (var i = 0; i < favs.length; i++) if (favs[i].u === u) return true;
    return false;
  }
  function save(favs) {
    localStorage.setItem(KEY, JSON.stringify(favs));
    refreshButtons();
    renderFavPage();
    markAlreadyFav();
  }
  function importHash() {
    if (location.hash.indexOf("#f=") !== 0) return;
    try {
      var incoming = dec(location.hash.slice(3));
      if (!incoming || !incoming.length) return;
      var byUrl = {};
      load().forEach(function (f) { byUrl[f.u] = f; });
      incoming.forEach(function (f) { if (f && f.u) byUrl[f.u] = f; });
      var merged = [];
      for (var k in byUrl) merged.push(byUrl[k]);
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch (e) {}
  }
  function favPageUrl() {
    var sc = document.querySelector('script[src*="fav.js"]');
    return sc ? sc.src.replace(/fav\.js.*$/, "favorites.html") : "favorites.html";
  }
  function favLink() { return favPageUrl() + "#f=" + enc(load()); }
  function refreshButtons() {
    var btns = document.querySelectorAll(".fav-btn");
    for (var i = 0; i < btns.length; i++) {
      var on = isFav(btns[i].getAttribute("data-u"));
      btns[i].textContent = on ? "★" : "☆";
      btns[i].className = on ? "fav-btn on" : "fav-btn";
      btns[i].title = on ? "取消收藏" : "收藏";
    }
    var chip = document.getElementById("fav-chip");
    if (chip) chip.textContent = load().length;
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
    var favs = load();
    if (isFav(u)) {
      favs = favs.filter(function (f) { return f.u !== u; });
    } else {
      favs.push({ t: b.getAttribute("data-t"), u: u,
                  s: b.getAttribute("data-s"), d: b.getAttribute("data-d"),
                  b: b.getAttribute("data-b") });
    }
    save(favs);
  });

  var sortDesc = true;
  window.adrToggleSort = function () { sortDesc = !sortDesc; renderFavPage(); };

  function renderFavPage() {
    var list = document.getElementById("fav-list");
    if (!list) return;
    var favs = load();
    var linkBox = document.getElementById("fav-link");
    if (linkBox) linkBox.textContent = favs.length ? favLink() : "收藏任意条目后，这里会生成你的专属链接";
    var q = (document.getElementById("fav-q").value || "").toLowerCase();
    var items = favs.filter(function (f) {
      return !q || ((f.t || "") + " " + (f.b || "") + " " + (f.s || "")).toLowerCase().indexOf(q) >= 0;
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

  window.adrCopy = function () {
    var link = favLink();
    function ok() {
      var b = document.getElementById("fav-copy");
      if (b) b.textContent = "已复制！粘贴存到书签或发到自己微信";
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(ok, fallback);
    } else { fallback(); }
  };

  importHash();
  document.addEventListener("DOMContentLoaded", function () {
    refreshButtons();
    renderFavPage();
    markAlreadyFav();
    var q = document.getElementById("fav-q");
    if (q) q.addEventListener("input", renderFavPage);
  });
})();

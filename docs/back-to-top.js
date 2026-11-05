/* 回到顶部：显隐动效 + 自定义回顶滚动（UI/UE 设计方案 + 评审复核修订）
   显隐: visibility+opacity 过渡；收起时立即置 inert（140ms 淡出窗口期即退出
   焦点/无障碍树，不依赖延迟后的 visibility）；回顶: rAF 自定义缓动，
   时长随距离自适应，用户滚动输入随时打断接管。 */
(function () {
  "use strict";

  var btn = document.querySelector(".back-to-top");
  if (!btn) {
    /* 动态创建（PAGE 模板未放静态节点；若未来模板加入静态按钮则直接复用） */
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "back-to-top";
    btn.setAttribute("aria-label", "回到顶部");
    btn.innerHTML = '<span class="btt-icon" aria-hidden="true">↑</span>';
    document.body.appendChild(btn);
  }

  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduceMotion() { return !!(mq && mq.matches); }

  var SHOW_AT = 400; // 越过即出现
  var HIDE_AT = 320; // 低于才消失：320-400 为回滞区，防阈值抖动

  var shown = false;
  var scheduled = false;

  function readY() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function setVisible(next) {
    if (next === shown) return;
    // 焦点在按钮上时不收起，避免焦点掉回 body（focusout 后由 sync 重评估）
    if (!next && btn.contains(document.activeElement)) return;
    shown = next;
    if (next) {
      btn.inert = false; // 恢复可聚焦（出场中反向展开立即恢复）
      btn.classList.add("visible");
    } else {
      btn.inert = true;  // 立即退出焦点/无障碍树（评审[阻塞]：不依赖延迟 visibility）
      btn.classList.remove("visible");
    }
  }

  function sync() {
    scheduled = false;
    var y = readY();
    if (!shown && y > SHOW_AT) setVisible(true);
    else if (shown && y < HIDE_AT) setVisible(false);
  }

  function onScroll() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(sync);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  btn.addEventListener("focusout", sync);
  btn.inert = true; // 初始隐藏态即 inert
  sync(); // 刷新后停在页面中部时也要正确显示

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function focusTop() {
    var heading = document.querySelector(".top h1");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); }
  }

  var stopScroll = null;

  function scrollTop() {
    var startY = readY();
    if (startY <= 0) { focusTop(); return; }
    if (stopScroll) return; // 动画进行中忽略重复点击

    if (reduceMotion()) {
      window.scrollTo(0, 0);
      focusTop();
      return;
    }

    var duration = Math.max(320, Math.min(900, 14 * Math.sqrt(startY)));
    var ease = startY > 2500 ? easeInOutCubic : easeOutCubic;
    var root = document.documentElement;
    var prevBehavior = root.style.scrollBehavior;
    var startTime = -1;
    var rafId = 0;

    root.style.scrollBehavior = "auto"; // 防止页面级 smooth 二次接管

    function cleanup() {
      stopScroll = null;
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
      root.style.scrollBehavior = prevBehavior;
      window.removeEventListener("wheel", cancel, { passive: true });
      window.removeEventListener("touchstart", cancel, { passive: true });
      window.removeEventListener("keydown", onKey);
    }

    function cancel() { if (stopScroll) cleanup(); }

    function onKey(e) {
      if (e.key === " " || e.key === "Spacebar" || /^(Arrow|Page|Home|End)/.test(e.key)) cancel();
    }

    function frame(now) {
      if (!stopScroll) return; // 中断后不得再执行末帧
      if (startTime < 0) startTime = now;
      var t = Math.min(1, (now - startTime) / duration);
      var y = Math.round(startY * (1 - ease(t)));
      window.scrollTo(0, y > 0 ? y : 0);
      if (t < 1) {
        rafId = window.requestAnimationFrame(frame);
      } else {
        cleanup();
        focusTop();
      }
    }

    stopScroll = cancel;
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("keydown", onKey);
    rafId = window.requestAnimationFrame(frame);
  }

  btn.addEventListener("click", scrollTop);

  // iOS 上 :active 不可靠，显式补按下态（评审建议：补 lostpointercapture/blur 清理）
  btn.addEventListener("pointerdown", function () {
    btn.classList.add("is-pressed");
  });
  ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach(function (type) {
    btn.addEventListener(type, function () { btn.classList.remove("is-pressed"); });
  });
  window.addEventListener("blur", function () { btn.classList.remove("is-pressed"); });
})();

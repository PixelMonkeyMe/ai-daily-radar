(function () {
  "use strict";
  /* ── 回到顶部浮动按钮（首页/收藏页，零依赖）──
     无障碍（评审建议）: button+aria-label、隐藏时 display:none 退出 Tab 序、
     点击后焦点移交顶部标题；性能: scroll passive 监听 + 跨越阈值才更新 DOM；
     prefers-reduced-motion 时平滑滚动降级为直接跳转 */

  var THRESHOLD = 400;

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "回到顶部");
  btn.textContent = "↑";
  document.body.appendChild(btn);

  var visible = false;
  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    var should = y > THRESHOLD;
    if (should === visible) return; /* 跨越阈值才触碰 DOM */
    visible = should;
    btn.classList.toggle("visible", visible);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  btn.addEventListener("click", function () {
    var reduce = window.matchMedia &&
                 window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    var h1 = document.querySelector(".top h1");
    if (h1) {
      if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }
  });
})();

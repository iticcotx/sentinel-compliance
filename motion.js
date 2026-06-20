/* Sentinel — "Command-Center" motion layer.
   Applies the futuristic skin (body.fx) and adds pointer-driven 3D tilt to cards.
   Pure vanilla, event-delegated so it survives app.js re-renders. No deps. */
(function () {
  var html = document.documentElement, body = document.body;
  html.setAttribute("data-theme", "dark");   // base the skin on the dark token set
  body.classList.add("fx");

  var fine = window.matchMedia("(hover:hover) and (pointer:fine)").matches;
  var reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (!fine || reduce) return;                // no tilt on touch / reduced-motion

  var SEL = ".item-row, .kpi, .group-head";
  var MAX = 6;                                // max tilt degrees
  var current = null, raf = 0, pending = null;

  function target(node) { return node && node.closest ? node.closest(SEL) : null; }
  function reset(el) { if (el) { el.style.transform = ""; el.style.transition = "transform .25s ease"; } }

  function apply() {
    raf = 0;
    if (!pending) return;
    var el = pending.el, x = pending.x, y = pending.y;
    if (current && current !== el) reset(current);
    current = el;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var px = (x - r.left) / r.width - 0.5;
    var py = (y - r.top) / r.height - 0.5;
    el.style.transition = "transform .06s linear";
    el.style.transform = "perspective(900px) rotateY(" + (px * MAX).toFixed(2) + "deg) rotateX(" +
      (-py * MAX).toFixed(2) + "deg) translateZ(6px)";
  }

  document.addEventListener("pointermove", function (e) {
    var el = target(e.target);
    if (!el) { if (current) { reset(current); current = null; } return; }
    pending = { el: el, x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });

  document.addEventListener("pointerout", function (e) {
    var el = target(e.target);
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;  // still inside
    reset(el);
    if (current === el) current = null;
  }, { passive: true });
})();

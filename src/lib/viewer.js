/*
 * viewer.js — a small pan/zoom image viewer with no dependencies.
 *
 * Classic UMD script: global `AgmViewer` in the browser, CommonJS in Node (where only the
 * pure geometry helpers are useful).
 *
 * View state is { scale, x, y }: the image is drawn at its natural size times `scale`, with its
 * top-left corner at (x, y) in frame pixels.
 *
 * Controls: drag to pan; mouse wheel / trackpad / pinch to zoom about the pointer;
 * double-click to zoom in; buttons for zoom in, zoom out and fit.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AgmViewer = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_SCALE = 8; // at most 8× the image's natural size

  /** State that fits an imgW×imgH image entirely in a frameW×frameH frame, centred. */
  function fitState(imgW, imgH, frameW, frameH) {
    if (!(imgW > 0 && imgH > 0 && frameW > 0 && frameH > 0)) return { scale: 1, x: 0, y: 0 };
    const scale = Math.min(frameW / imgW, frameH / imgH);
    return { scale, x: (frameW - imgW * scale) / 2, y: (frameH - imgH * scale) / 2 };
  }

  /**
   * Zoom by `factor` keeping frame point (px, py) fixed on the same image point.
   * The scale is clamped to [minScale, MAX_SCALE].
   */
  function zoomAt(state, factor, px, py, minScale) {
    const lo = Math.min(minScale || state.scale, 1);
    const scale = Math.max(lo, Math.min(MAX_SCALE, state.scale * factor));
    const k = scale / state.scale;
    return { scale, x: px - (px - state.x) * k, y: py - (py - state.y) * k };
  }

  /**
   * Build a viewer inside `container` (emptied first).
   * Returns { load(url, alt), fit(), zoom(factor), state(), element }.
   */
  function createViewer(container) {
    const doc = container.ownerDocument;
    const mk = (tag, cls, attrs) => Object.assign(doc.createElement(tag), { className: cls }, attrs || {});

    const frame = mk("div", "viewer-frame", { tabIndex: 0 });
    const img = mk("img", "viewer-img", { draggable: false, alt: "" });
    const msg = mk("div", "viewer-msg");
    frame.append(img, msg);

    const bar = mk("div", "viewer-bar");
    const btn = (label, title, fn) => {
      const b = mk("button", "viewer-btn", { type: "button", textContent: label, title });
      b.setAttribute("aria-label", title);
      b.addEventListener("click", fn);
      bar.append(b);
    };
    btn("+", "Zoom in", () => zoom(1.5));
    btn("−", "Zoom out", () => zoom(1 / 1.5));
    btn("Fit", "Fit image to frame", () => fit());
    container.replaceChildren(frame, bar);

    let st = { scale: 1, x: 0, y: 0 };
    let fitScale = 1;
    let loaded = false;

    function apply() {
      img.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.scale})`;
    }
    function center() {
      return { x: frame.clientWidth / 2, y: frame.clientHeight / 2 };
    }
    function fit() {
      if (!loaded) return;
      st = fitState(img.naturalWidth, img.naturalHeight, frame.clientWidth, frame.clientHeight);
      fitScale = st.scale;
      apply();
    }
    function zoom(factor, px, py) {
      if (!loaded) return;
      const c = center();
      st = zoomAt(st, factor, px ?? c.x, py ?? c.y, fitScale);
      apply();
    }
    function local(e) {
      const r = frame.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // Pointer handling: one pointer pans, two pointers pinch-zoom.
    const pointers = new Map();
    let pinchDist = 0;
    frame.addEventListener("pointerdown", (e) => {
      if (!loaded) return;
      frame.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      frame.classList.add("dragging");
    });
    frame.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        st = { ...st, x: st.x + p.x - prev.x, y: st.y + p.y - prev.y };
        apply();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoom(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDist = d;
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
      if (!pointers.size) frame.classList.remove("dragging");
    };
    frame.addEventListener("pointerup", release);
    frame.addEventListener("pointercancel", release);

    frame.addEventListener("wheel", (e) => {
      if (!loaded) return;
      e.preventDefault();
      const p = local(e);
      zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), p.x, p.y);
    }, { passive: false });
    frame.addEventListener("dblclick", (e) => { const p = local(e); zoom(2, p.x, p.y); });
    frame.addEventListener("keydown", (e) => {
      const step = 40;
      const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (e.key === "+" || e.key === "=") zoom(1.5);
      else if (e.key === "-") zoom(1 / 1.5);
      else if (e.key === "0") fit();
      else if (moves[e.key]) { st = { ...st, x: st.x + moves[e.key][0], y: st.y + moves[e.key][1] }; apply(); }
      else return;
      e.preventDefault();
    });

    img.addEventListener("load", () => {
      loaded = true;
      msg.textContent = "";
      frame.classList.remove("empty");
      fit();
    });
    img.addEventListener("error", () => {
      loaded = false;
      img.style.transform = "";
      frame.classList.add("empty");
      msg.textContent = `Could not load image ${img.src}`;
    });

    function load(url, alt) {
      loaded = false;
      frame.classList.add("empty");
      msg.textContent = "Loading image…";
      img.alt = alt || "";
      img.src = url;
    }

    return { load, fit, zoom, state: () => ({ ...st }), element: frame };
  }

  return { createViewer, fitState, zoomAt, MAX_SCALE };
});

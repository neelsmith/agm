/*
 * viewer.js — a small pan/zoom image viewer with no dependencies.
 *
 * Classic UMD script: global `AgmViewer` in the browser, CommonJS in Node (where only the
 * pure geometry helpers are useful).
 *
 * View state is { scale, x, y }: the image is drawn at its natural size times `scale`, with its
 * top-left corner at (x, y) in frame pixels.
 *
 * Regions of interest (fractions 0..1 of the image's width/height: left, top, width, height)
 * are drawn as outlined boxes in an overlay; their screen positions are recomputed on every
 * pan/zoom, so outlines stay a constant width at any zoom.
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

  /** Screen-pixel box of a region `roi` {left, top, width, height} (fractions of the image). */
  function regionBox(state, imgW, imgH, roi) {
    return {
      left: state.x + roi.left * imgW * state.scale,
      top: state.y + roi.top * imgH * state.scale,
      width: roi.width * imgW * state.scale,
      height: roi.height * imgH * state.scale,
    };
  }

  /**
   * Build a viewer inside `container` (emptied first).
   * Returns { load(url, alt), fit(), zoom(factor), state(), element,
   *   setRegions([{ id, roi, kind, title }]), highlight(id | null), onRegionHover(fn) }.
   * Several regions may share an id; highlight(id) marks all of them.
   * onRegionHover(fn) calls fn(id) when the pointer enters a region and fn(null) when it leaves.
   */
  function createViewer(container) {
    const doc = container.ownerDocument;
    const mk = (tag, cls, attrs) => Object.assign(doc.createElement(tag), { className: cls }, attrs || {});

    const frame = mk("div", "viewer-frame", { tabIndex: 0 });
    const img = mk("img", "viewer-img", { draggable: false, alt: "" });
    const msg = mk("div", "viewer-msg");
    const overlay = mk("div", "viewer-regions");
    frame.append(img, overlay, msg);

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
    let regions = []; // [{ id, roi, el }]
    let hoverFn = null;
    let highlighted = null;
    let dragging = false;

    function apply() {
      img.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.scale})`;
      if (!loaded) return;
      for (const r of regions) {
        const b = regionBox(st, img.naturalWidth, img.naturalHeight, r.roi);
        Object.assign(r.el.style, {
          left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`,
        });
      }
    }

    function setRegions(list) {
      regions = (list || []).filter((r) => r && r.roi).map((r) => {
        const e = mk("div", `viewer-region${r.kind ? " kind-" + r.kind : ""}`, { title: r.title || r.id });
        e.dataset.id = r.id;
        e.addEventListener("pointerenter", () => { if (!dragging && hoverFn) hoverFn(r.id); });
        e.addEventListener("pointerleave", () => { if (!dragging && hoverFn) hoverFn(null); });
        return { id: r.id, roi: r.roi, el: e };
      });
      overlay.replaceChildren(...regions.map((r) => r.el));
      highlight(highlighted);
      apply();
    }

    function highlight(id) {
      highlighted = id || null;
      for (const r of regions) r.el.classList.toggle("active", highlighted !== null && r.id === highlighted);
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
      dragging = true;
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
      if (!pointers.size) { dragging = false; frame.classList.remove("dragging"); }
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

    return {
      load, fit, zoom, setRegions, highlight,
      onRegionHover: (fn) => { hoverFn = fn; },
      state: () => ({ ...st }),
      element: frame,
    };
  }

  return { createViewer, fitState, zoomAt, regionBox, MAX_SCALE };
});

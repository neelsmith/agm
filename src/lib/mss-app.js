/* mss-app.js — UI for mss.html. Depends on globals AgmCex, AgmViewer, AgmMss and AgmNotation. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // Data-source controls exist only in the fixture build (see build.js), so these may be null.
  const urlInput = $("url");
  const loadButton = $("load");
  const fileInput = $("file");
  const statusEl = $("status");
  const msSelect = $("ms");
  const msOut = $("ms-out");

  /** App state, exposed for console inspection. */
  window.mss = { data: null, ms: null, entries: [], selected: null, viewer: null, selectManuscript, selectImage, closeImage };

  if (urlInput) urlInput.value = AgmCex.DEFAULT_URL;

  function setStatus(msg, isError, title) {
    statusEl.textContent = msg;
    statusEl.title = title || "";
    statusEl.className = isError ? "error" : "";
  }

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, attrs || {});
    for (const k of kids) if (k !== null && k !== undefined && k !== "") e.append(k);
    return e;
  }

  /* ---------- manuscript menu ---------- */

  function renderMenu(d) {
    const menu = AgmMss.manuscriptMenu(d);
    msSelect.replaceChildren(
      el("option", { value: "", textContent: menu.length ? "Choose a manuscript…" : "No manuscripts in this release" }),
      ...menu.map((m) => el("option", { value: m.urn, textContent: m.label })));
    msSelect.disabled = menu.length === 0;
    msOut.replaceChildren();
  }

  let loadToken = 0; // ignore results for a manuscript the user has since moved away from

  async function selectManuscript(urn) {
    msSelect.value = urn || "";
    const token = ++loadToken;
    Object.assign(window.mss, { ms: null, entries: [], selected: null, viewer: null });
    grid = pageSection = pageHead = viewerHolder = textSection = null;
    const ms = AgmMss.manuscriptMenu(window.mss.data || {}).find((m) => m.urn === urn);
    if (!ms) { msOut.replaceChildren(); return null; }
    window.mss.ms = ms;

    const status = el("p", { className: "counts", textContent: "Loading manifest and URN map…" });
    msOut.replaceChildren(
      el("h2", { textContent: ms.label }),
      el("p", { className: "urn-line" }, el("code", { textContent: ms.urn })),
      status);

    let result;
    try {
      result = await AgmMss.loadManuscript(window.mss.data, ms);
    } catch (e) {
      if (token === loadToken) status.replaceChildren(el("span", { className: "note", textContent: `Could not load: ${e.message}` }));
      return null;
    }
    if (token !== loadToken) return null;

    const { entries, counts, warnings } = result;
    window.mss.entries = entries;
    status.replaceChildren(`${counts.images} image(s), ${counts.found} captioned from the URN map`,
      counts.missing ? el("span", { className: "missing", textContent: `, ${counts.missing} not found` }) : "",
      ", ",
      el("span", { className: "dse-count", textContent: `${counts.withDse} with DSE records` }),
      ".");
    if (warnings.length) {
      msOut.append(el("details", { className: "ms-warnings" },
        el("summary", { textContent: `${warnings.length} warning(s)` }),
        el("ul", null, ...warnings.map((w) => el("li", { textContent: w })))));
    }
    grid = lightTableEl(entries);
    textSection = el("section", { className: "page-text", id: "page-text" });
    textSection.hidden = true;
    msOut.append(dseFilter(counts.withDse), el("div", { className: "stage" }, pageView(), grid), textSection);
    return result;
  }

  /* ---------- light table ---------- */

  function lightTableEl(entries) {
    const grid = el("div", { className: "light-table", id: "light-table" });
    entries.forEach((e, i) => {
      const img = el("img", { src: e.thumb, alt: e.label, loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => img.classList.add("broken"));
      const badge = e.dse
        ? el("span", { className: "dse-badge", textContent: String(e.dse), title: `${e.dse} DSE record(s)` })
        : null;
      const btn = el("button", {
        type: "button",
        className: "thumb" + (e.found ? "" : " not-found") + (e.dse ? " has-dse" : ""),
        title: (e.urn || e.service) + (e.dse ? `\n${e.dse} DSE record(s)` : ""),
      }, el("figure", { style: "margin:0" }, img, badge, el("figcaption", { textContent: e.label })));
      btn.dataset.index = String(i);
      btn.addEventListener("click", () => selectImage(i));
      grid.append(btn);
    });
    return grid;
  }

  /** "Only images with DSE records" toggle for the light table (hides the others). */
  function dseFilter(n) {
    const box = el("input", { type: "checkbox", id: "dse-only", disabled: n === 0 });
    box.addEventListener("change", () => {
      if (grid) grid.classList.toggle("dse-only", box.checked);
    });
    return el("label", { className: "dse-filter", htmlFor: "dse-only" }, box,
      el("span", { className: "dse-swatch" }), ` Only images with DSE records (${n})`);
  }

  /* ---------- selected image: pan/zoom view ---------- */

  let grid = null;         // the light table
  let pageHead = null;
  let viewerHolder = null;
  let pageSection = null;  // the full-image view; replaces the light table while open
  let gridScroll = 0;      // light-table scroll position, restored on close
  let textSection = null;  // passages indexed to the open image, shown below it

  function pageView() {
    pageHead = el("div", { className: "page-head" });
    viewerHolder = el("div", { className: "viewer" });
    pageSection = el("section", { className: "page-view", id: "page-view" }, pageHead, viewerHolder);
    pageSection.hidden = true;
    return pageSection;
  }

  /**
   * Show light-table entry `i` in the pan/zoom viewer, in place of the light table
   * (Close or Escape returns to the light table).
   */
  function selectImage(i) {
    const entries = window.mss.entries;
    const e = entries[i];
    if (!e || !pageSection) return null;
    window.mss.selected = i;
    for (const t of document.querySelectorAll(".thumb.selected")) t.classList.remove("selected");
    const thumb = document.querySelector(`.thumb[data-index="${i}"]`);
    if (thumb) thumb.classList.add("selected");

    const prev = el("button", { type: "button", textContent: "‹ Previous", disabled: i === 0 });
    const next = el("button", { type: "button", textContent: "Next ›", disabled: i === entries.length - 1 });
    const close = el("button", { type: "button", className: "close", textContent: "✕ Close", title: "Back to the light table (Esc)" });
    prev.addEventListener("click", () => selectImage(i - 1));
    next.addEventListener("click", () => selectImage(i + 1));
    close.addEventListener("click", closeImage);
    const meta = [e.page ? e.page.urn : null, e.urn, e.dse ? `${e.dse} DSE record(s)` : null]
      .filter(Boolean).join(" · ");
    pageHead.replaceChildren(
      el("h3", { className: e.found ? "" : "not-found", textContent: e.page ? e.page.label : e.label }),
      meta ? el("span", { className: "meta", textContent: meta }) : el("span", { className: "meta not-found", textContent: `not in URN map: ${e.service}` }),
      el("span", { className: "page-nav" }, prev, next, close));

    if (pageSection.hidden) {
      gridScroll = grid ? grid.scrollTop : 0; // display:none can lose it, so keep it ourselves
      if (grid) grid.hidden = true;
      pageSection.hidden = false;
    }
    if (!window.mss.viewer) window.mss.viewer = AgmViewer.createViewer(viewerHolder);
    window.mss.viewer.load(e.full, e.label);
    renderPassages(e);
    if (!isOnScreen(pageSection)) pageSection.scrollIntoView({ block: "nearest" });
    return e;
  }

  /** Close the full-image view and return to the light table where it was. */
  function closeImage() {
    if (!pageSection || pageSection.hidden) return;
    pageSection.hidden = true;
    if (textSection) textSection.hidden = true;
    if (!grid) return;
    grid.hidden = false;
    grid.scrollTop = gridScroll;
    // Keep the last-viewed thumbnail (Previous/Next may have moved on) visible and focused.
    const thumb = grid.querySelector(".thumb.selected");
    if (thumb) {
      const g = grid.getBoundingClientRect(), t = thumb.getBoundingClientRect();
      if (t.top < g.top) grid.scrollTop -= g.top - t.top + 12;
      else if (t.bottom > g.bottom) grid.scrollTop += t.bottom - g.bottom + 12;
      thumb.focus({ preventScroll: true });
    }
  }

  document.addEventListener("keydown", (e) => {
    if (!pageSection || pageSection.hidden) return;
    if (e.key === "Escape") { closeImage(); e.preventDefault(); }
  });

  /* ---------- text indexed to the open image ---------- */

  /** Show the `#!texts_cols` passages that DSE records index to entry `e`'s image. */
  function renderPassages(e) {
    if (!textSection) return;
    const passages = e.urn ? AgmMss.imagePassages(window.mss.data, e.urn) : [];
    showRegions(passages); // always: clears the previous image's regions when there are none
    textSection.hidden = passages.length === 0;
    if (!passages.length) { textSection.replaceChildren(); return; }

    const works = [...new Set(passages.map((p) => p.catalog)
      .filter(Boolean).map((c) => [c.groupName, c.workTitle].filter(Boolean).join(", ")))];
    const list = el("ol", { className: "passages" });
    for (const p of passages) {
      list.append(linked(el("li", { className: "passage" + (p.row ? "" : " missing") + (p.roi ? " has-roi" : "") },
        el("span", { className: "ref", textContent: p.passage, title: p.urn }),
        p.row ? passageBody(p.row)
          : el("span", { className: "note", textContent: "not found in #!texts_cols" })), p.urn));
    }
    textSection.replaceChildren(
      el("h3", { textContent: `Text on this image (${passages.length} passage${passages.length === 1 ? "" : "s"})` },
        works.length ? el("span", { className: "work", textContent: ` · ${works.join("; ")}` }) : null),
      list);
  }

  /* ---------- linked highlighting: image regions ↔ text passages ---------- */

  let highlighted = null;

  /** Draw the passages' regions of interest on the image, keyed by passage URN. */
  function showRegions(passages) {
    const viewer = window.mss.viewer;
    highlighted = null;
    if (!viewer) return;
    viewer.setRegions(passages.filter((p) => p.roi)
      .map((p) => ({ id: p.urn, roi: p.roi, kind: "text", title: p.passage })));
    viewer.onRegionHover((id) => highlight(id));
    viewer.highlight(null);
  }

  /** Highlight passage `urn` in the text panel and its region(s) on the image; null clears. */
  function highlight(urn) {
    highlighted = urn || null;
    if (textSection) {
      for (const li of textSection.querySelectorAll(".passage")) {
        li.classList.toggle("hl", highlighted !== null && li.dataset.urn === highlighted);
      }
    }
    if (window.mss.viewer) window.mss.viewer.highlight(highlighted);
  }
  window.mss.highlight = highlight;

  /** Tag a passage element with its URN so hovering it highlights its region. */
  function linked(node, urn) {
    node.dataset.urn = urn;
    node.addEventListener("pointerenter", () => highlight(urn));
    node.addEventListener("pointerleave", () => { if (highlighted === urn) highlight(null); });
    return node;
  }

  /** A `#!texts_cols` row: its cells side by side, with Sowerby note URNs shown as Unicode signs. */
  function passageBody(row) {
    const body = el("div", { className: "cells" });
    body.style.gridTemplateColumns = `repeat(${Math.max(row.cells.length, 1)}, minmax(0, auto))`;
    for (const cell of row.cells) body.append(cellEl(cell));
    return body;
  }

  function cellEl(text) {
    const cell = el("span", { className: "cell greek" });
    for (const seg of AgmNotation.splitEmbeddedNotation(text)) {
      cell.append(seg.urn
        ? el("span", {
            className: "mousike-notation note-sign" + (seg.ok ? "" : " unknown"),
            textContent: seg.unicode,
            title: seg.urn,
          })
        : seg.text);
    }
    return cell;
  }

  /** True when all of `node` is within the window. */
  function isOnScreen(node) {
    const r = node.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }

  msSelect.addEventListener("change", () => selectManuscript(msSelect.value));

  /* ---------- loading the release ---------- */

  function accept(d, source) {
    window.mss.data = d;
    setStatus(`Loaded mousike release ${d.version}`, false, `Source: ${source}`);
    renderMenu(d);
  }
  window.mss.accept = accept;

  async function loadUrl() {
    const url = (urlInput && urlInput.value.trim()) || AgmCex.DEFAULT_URL;
    setStatus("Loading…");
    try {
      accept(await AgmCex.loadCex(url), url);
    } catch (e) {
      setStatus(`Could not load ${url}: ${e.message}.` + (fileInput ? " Try loading a local copy instead." : ""), true);
    }
  }

  if (loadButton) loadButton.addEventListener("click", loadUrl);
  if (urlInput) urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loadUrl(); });
  if (fileInput) fileInput.addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { accept(AgmCex.parseCex(await f.text()), f.name); }
    catch (err) { setStatus(`Could not parse ${f.name}: ${err.message}`, true); }
  });

  if (!window.AGM_NO_AUTOLOAD) loadUrl();
})();

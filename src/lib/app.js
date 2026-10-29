/* app.js — UI for the agm reader. Depends on globals AgmCex, AgmEdition, AgmNotation and AgmViewer. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // Data-source controls exist only in some builds (see build.js), so these may be null.
  const urlInput = $("url");
  const loadButton = $("load");
  const fileInput = $("file");
  const statusEl = $("status");
  const surfaceSelect = $("surface");
  const surfaceOut = $("surface-out");
  const dataOut = $("data-out");

  /** App state, exposed for console inspection and tests. */
  window.agm = { data: null, selectSurface };

  if (urlInput) urlInput.value = AgmCex.DEFAULT_URL;

  function setStatus(msg, isError, title) {
    statusEl.textContent = msg;
    statusEl.title = title || "";
    statusEl.className = isError ? "error" : "";
  }

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, attrs || {});
    for (const k of kids) e.append(k);
    return e;
  }

  /* ---------- surface menu and contents ---------- */

  function renderSurfaceMenu(d) {
    const menu = AgmEdition.surfaceMenu(d);
    surfaceSelect.replaceChildren(
      el("option", { value: "", textContent: menu.length ? "Choose an artifact…" : "No artifacts in this release" }),
      ...menu.map((s) => el("option", { value: s.urn, textContent: s.label }))
    );
    surfaceSelect.disabled = menu.length === 0;
    surfaceOut.replaceChildren();
  }

  /** Notation rendered in the Mousike Notation font, with the URN encoding below it. */
  function notationEl(urnText, extra) {
    return el("div", { className: "content" },
      el("div", { className: "mousike-notation", textContent: AgmNotation.notesToUnicodeSafe(urnText) }),
      el("div", { className: "notation" }, el("span", { textContent: urnText }), extra || ""));
  }

  function contentEl(p) {
    if (p.block === "notes") {
      const n = p.unit === "group" ? p.record.notes.length : 0;
      return notationEl(p.record.text,
        n > 1 ? el("span", { className: "count", textContent: ` (${n} notes on one syllable)` }) : null);
    }
    return el("div", { className: "content greek", textContent: p.record.text });
  }

  function passageBody(p) {
    if (p.match === "exact") return contentEl(p);
    if (p.match === "container") {
      return el("div", null,
        el("div", { className: "note", textContent: `Not found in ${p.block}. Containing passage ${shortRef(p.record.urn)}:` }),
        contentEl(p));
    }
    return el("div", { className: "note", textContent: "Not found in texts, notes or syllables." });
  }

  function selectSurface(urn) {
    surfaceSelect.value = urn || "";
    window.agm.surface = urn || null;
    window.agm.viewer = null;
    const d = window.agm.data;
    if (!d || !urn) { surfaceOut.replaceChildren(); return null; }
    const view = AgmEdition.surfaceContents(d, urn);
    const { counts } = view;

    const head = el("p", { className: "counts" });
    head.textContent = counts.total === 0
      ? "No DSE records for this artifact."
      : `${counts.total} DSE record(s): ${counts.exact} resolved` +
        (counts.container ? `, ${counts.container} only to a containing passage` : "") +
        (counts.missing ? `, ${counts.missing} not found` : "") + ".";

    const list = el("ol", { className: "entries" });
    for (const { dse, passage } of view.entries) {
      const roi = dse.roi;
      list.append(el("li", { className: passage.match === "exact" ? "entry" : "entry unresolved" },
        el("div", { className: "entry-head" },
          el("span", { className: "ref", textContent: shortRef(dse.text), title: dse.text }),
          el("span", {
            className: "roi",
            textContent: roi ? "region " + [roi.left, roi.top, roi.width, roi.height].join(", ") : "no region",
            title: dse.image,
          })),
        passageBody(passage)));
    }

    surfaceOut.replaceChildren(
      el("h2", { textContent: view.surface ? view.surface.label : urn }),
      el("p", { className: "urn-line" }, el("code", { textContent: urn })),
      linesView(AgmEdition.surfaceLines(d, urn)),
      imageSection(AgmEdition.surfaceImages(d, urn)),
      el("details", { className: "dse-panel" },
        el("summary", { textContent: `DSE records (${counts.total})` }),
        head,
        list));
    return view;
  }

  /* ---------- image menu: distinct images cited by the surface's DSE records ---------- */

  let imageOut = null; // element holding the viewer for the selected image

  /** Image menu plus a pan/zoom view of the selected image (first one preselected). */
  function imageSection(images) {
    window.agm.images = images;
    window.agm.image = null;
    if (!images.length) {
      imageOut = null;
      return el("p", { className: "note", textContent: "No images cited for this artifact." });
    }
    const select = el("select", { id: "image" },
      ...images.map((im) => el("option", {
        value: im.urn,
        textContent: im.image ? im.label : `${im.label} (not in image catalog)`,
        title: im.urn,
      })));
    select.addEventListener("change", () => selectImage(select.value));
    imageOut = el("div", { className: "image-out" });
    const sec = el("section", { className: "image-section" },
      el("div", { className: "image-picker" },
        el("label", { htmlFor: "image", textContent: "Image" }), select),
      imageOut);
    // Defer so the section is in the document (the viewer needs its size to fit the image).
    setTimeout(() => selectImage(images[0].urn), 0);
    return sec;
  }

  /** Make `urn` (an image URN without region of interest) the selected image and show it. */
  function selectImage(urn) {
    const im = (window.agm.images || []).find((x) => x.urn === urn);
    if (!im || !imageOut) return null;
    window.agm.image = urn;
    const select = $("image");
    if (select) select.value = urn;

    const url = AgmEdition.imageUrl(im.image);
    if (!url) {
      imageOut.replaceChildren(el("p", { className: "note",
        textContent: `${urn} is not in the image catalog, so it can't be displayed.` }));
      return urn;
    }
    const holder = el("div", { className: "viewer" });
    imageOut.replaceChildren(holder);
    const viewer = AgmViewer.createViewer(holder);
    window.agm.viewer = viewer;

    // Regions of interest on this image, linked to the line view by DSE text URN.
    const regions = AgmEdition.imageRegions(window.agm.data, window.agm.surface, urn);
    viewer.setRegions(regions.map((r) => ({ id: r.id, roi: r.roi, kind: r.kind, title: shortRef(r.id) })));
    viewer.onRegionHover((id) => highlight(id));
    const withRegion = new Set(regions.map((r) => r.id));
    for (const e of surfaceOut.querySelectorAll("[data-urn]")) {
      e.classList.toggle("has-roi", withRegion.has(e.dataset.urn));
    }
    highlight(null);

    viewer.load(url, im.label);
    if (regions.length) {
      imageOut.append(el("p", { className: "roi-key" },
        el("span", { className: "sw", style: "border-color: rgba(255,190,60,.95)" }), "notes",
        el("span", { className: "sw", style: "border-color: rgba(80,200,255,.95)" }), "syllables",
        ` · ${regions.length} region(s). Hover a region or a syllable/note to link them.`));
    }
    if (im.image.credits) {
      imageOut.append(el("p", { className: "credits", textContent: im.image.credits }));
    }
    return urn;
  }
  window.agm.selectImage = selectImage;

  /* ---------- linked highlighting: line view ↔ image regions ---------- */

  let highlighted = null;

  /** Highlight passage `urn` (a DSE text URN) in the line view and on the image; null clears. */
  function highlight(urn) {
    highlighted = urn || null;
    for (const e of surfaceOut.querySelectorAll(".hl")) e.classList.remove("hl");
    if (highlighted) {
      for (const e of surfaceOut.querySelectorAll("[data-urn]")) {
        if (e.dataset.urn === highlighted) e.classList.add("hl");
      }
    }
    if (window.agm.viewer) window.agm.viewer.highlight(highlighted);
  }
  window.agm.highlight = highlight;

  /** Tag a line-view element with its passage URN so it links to image regions. */
  function linked(e, urn) {
    e.dataset.urn = urn;
    e.addEventListener("pointerenter", () => highlight(urn));
    e.addEventListener("pointerleave", () => { if (highlighted === urn) highlight(null); });
    return e;
  }

  /* ---------- line view: syllables with their note groups above ---------- */

  function linesView(texts) {
    const sec = el("section", { className: "lines" });
    if (!texts.length) {
      sec.append(el("p", { className: "note", textContent: "No syllables or notes for this artifact." }));
      return sec;
    }
    for (const { base, lines } of texts) {
      if (texts.length > 1) sec.append(el("h3", { textContent: shortRef(base) }));
      for (const ln of lines) sec.append(lineEl(ln));
    }
    return sec;
  }

  function lineEl(ln) {
    const head = el("div", { className: "line-head" },
      el("span", { className: "line-no", textContent: `Line ${ln.line}` }));
    if (!ln.aligned) {
      head.append(el("span", {
        className: "note",
        textContent: `${ln.syllables.length} syllable(s), ${ln.groups.length} note group(s)`,
      }));
    }
    const row = el("div", { className: "line-row" });
    for (const c of ln.columns) {
      const g = c.group, s = c.syllable;
      const col = el("div", { className: "col" + (g && s ? "" : " unmatched") });
      col.append(g
        ? linked(el("div", {
            className: "mousike-notation col-notes",
            textContent: AgmNotation.notesToUnicodeSafe(g.text),
            title: `${shortRef(g.urn)}  ${g.text}`,
          }), g.urn)
        : el("div", { className: "col-notes missing", textContent: "—", title: "no note group" }));
      col.append(s
        ? linked(el("div", { className: "greek col-syl", textContent: s.text, title: shortRef(s.urn) }), s.urn)
        : el("div", { className: "col-syl missing", textContent: "—", title: "no syllable" }));
      row.append(col);
    }
    return el("div", { className: ln.aligned ? "line" : "line misaligned" }, head, row);
  }

  /** "urn:cts:mousike:epigraphic.seikilos.notes:1.1" -> "notes:1.1" */
  function shortRef(urn) {
    const { work, passage } = AgmCex.ctsParts(urn);
    return `${work.split(".").pop()}${passage ? ":" + passage : ""}`;
  }

  surfaceSelect.addEventListener("change", () => selectSurface(surfaceSelect.value));

  /* ---------- raw data inspector ---------- */

  const GREEK_COLS = { texts: ["text"], syllables: ["text"] };

  function tableFor(name, rows) {
    const cols = AgmCex.BLOCK_SCHEMAS[name];
    const t = el("table");
    t.append(el("thead", null, el("tr", null, ...cols.map((c) => el("th", { textContent: c })))));
    const tb = el("tbody");
    for (const r of rows) {
      tb.append(el("tr", null, ...cols.map((c) => {
        const v = r[c];
        let cls = "";
        if (/^urn:/.test(v)) cls = "urn";
        else if ((GREEK_COLS[name] || []).includes(c)) cls = "greek";
        return el("td", { textContent: v, className: cls });
      })));
    }
    t.append(tb);
    return el("div", { className: "scroll" }, t);
  }

  function renderData(d) {
    dataOut.replaceChildren();
    const summary = el("div", { className: "summary" });
    summary.append(el("div", null, el("b", { textContent: d.version ?? "—" }), el("span", { textContent: "version" })));
    for (const name of AgmCex.BLOCK_NAMES.slice(1)) {
      summary.append(el("div", null, el("b", { textContent: String(d[name].length) }), el("span", { textContent: name })));
    }
    dataOut.append(summary);

    if (d.warnings.length) {
      dataOut.append(el("details", { className: "warnings" },
        el("summary", { textContent: `${d.warnings.length} warning(s)` }),
        el("ul", null, ...d.warnings.map((w) => el("li", { textContent: w })))));
    }
    for (const name of AgmCex.BLOCK_NAMES.slice(1)) {
      dataOut.append(el("details", null,
        el("summary", { textContent: `#!${name} (${d[name].length})` }),
        tableFor(name, d[name])));
    }
  }

  /* ---------- loading ---------- */

  function accept(d, source) {
    window.agm.data = d;
    setStatus(`Loaded mousike release ${d.version}`, false, `Source: ${source}`);
    renderSurfaceMenu(d);
    renderData(d);
  }
  window.agm.accept = accept;

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

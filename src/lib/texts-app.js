/* texts-app.js — UI for agm-texts.html. Depends on globals AgmCex, AgmNotation, AgmViewer and AgmTexts. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // Data-source controls exist only in the fixture build (see build.js), so these may be null.
  const urlInput = $("url");
  const loadButton = $("load");
  const fileInput = $("file");
  const statusEl = $("status");
  const textSelect = $("text");
  const textOut = $("text-out");

  /** App state, exposed for console inspection. */
  window.texts = { data: null, menu: [], text: null, passages: [], passage: null, selection: [], images: [],
    viewer: null, selectText, selectPassage, selectReference, showImage };

  const urnmapCache = new Map(); // urnmap URL -> parsed rows, shared across passages

  if (urlInput) urlInput.value = AgmCex.DEFAULT_URL;

  function setStatus(msg, isError, title) {
    statusEl.textContent = msg;
    statusEl.title = title || "";
    statusEl.className = isError ? "error" : "";
  }

  /** Drop null/empty items, for replaceChildren (which would turn `null` into text). */
  const present = (...nodes) => nodes.filter((n) => n !== null && n !== undefined && n !== "");

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, attrs || {});
    for (const k of kids) if (k !== null && k !== undefined && k !== "") e.append(k);
    return e;
  }

  /* ---------- the menu of texts, from #!catalog_embedded and #!catalog_annotated ---------- */

  function renderMenu(d) {
    const menu = AgmTexts.textMenu(d);
    window.texts.menu = menu;
    const groups = [];
    for (const cat of AgmTexts.CATALOGS) {
      const items = menu.filter((t) => t.kind === cat.kind);
      if (!items.length) continue;
      groups.push(el("optgroup", { label: cat.heading },
        ...items.map((t) => el("option", { value: t.work, textContent: t.label, title: t.urn }))));
    }
    textSelect.replaceChildren(
      el("option", { value: "", textContent: menu.length ? "Choose a text…" : "No cataloged texts in this release" }),
      ...groups);
    textSelect.disabled = menu.length === 0;
    textOut.replaceChildren();
  }

  /** Select a text by work URN (without trailing colon) and show its catalog record. */
  function selectText(work) {
    textSelect.value = work || "";
    const t = window.texts.menu.find((x) => x.work === work) || null;
    window.texts.text = t;
    if (!t) { textOut.replaceChildren(); return null; }

    const c = t.catalog;
    const n = AgmTexts.passagesFor(window.texts.data, t.work).length;
    const passages = AgmTexts.textPassages(window.texts.data, t.work);
    const indexed = passages.filter((p) => p.records.length).length;
    window.texts.passages = passages;
    window.texts.passage = null;
    const fields = [
      ["Group", c.groupName], ["Work", c.workTitle], ["Version", c.versionLabel],
      ["Exemplar", c.exemplarLabel], ["Citation", c.citationScheme], ["Language", c.language],
      ["Online", c.online], ["Passages", String(n)], ["With images (DSE)", String(indexed)],
    ].filter(([, v]) => v !== undefined && v !== null && v !== "");
    textOut.replaceChildren(
      el("h2", { textContent: t.label }),
      el("p", { className: "urn-line" }, el("code", { textContent: t.urn }), " ",
        el("span", { className: "kind", textContent: t.heading })),
      el("dl", { className: "catalog-record" },
        ...fields.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })])),
      passagePicker(passages),
      el("section", { id: "passage-out" }));
    return t;
  }

  /* ---------- choosing passages: menu or reference ---------- */

  /**
   * Two ways to choose passages: a menu of all the text's passages (those indexed to an image are
   * marked ◆), or a reference typed in the box: "1.1", a level such as "1", or a range "1.1-1.4",
   * "1-2.1".
   */
  function passagePicker(passages) {
    if (!passages.length) {
      return el("p", { className: "note muted", textContent: "This release has no passages of this text." });
    }
    const indexed = passages.filter((p) => p.records.length).length;
    const select = el("select", { id: "passage" },
      el("option", { value: "", textContent: `Choose a passage… (${passages.length}; ◆ ${indexed} with images)` }),
      ...passages.map((p) => el("option", { value: p.urn, textContent: optionLabel(p), title: p.urn })));
    select.addEventListener("change", () => {
      const ref = $("ref");
      if (ref) ref.value = "";
      setRefError("");
      selectPassage(select.value);
    });

    const example = refExample(passages);
    const ref = el("input", { type: "text", id: "ref", placeholder: example, spellcheck: false, autocomplete: "off",
      title: `A passage (${passages[0].passage}), a level, or a range such as ${example}` });
    const go = el("button", { type: "button", textContent: "Show" });
    const run = () => selectReference(ref.value);
    go.addEventListener("click", run);
    ref.addEventListener("keydown", (e) => { if (e.key === "Enter") { run(); e.preventDefault(); } });
    return el("section", { className: "passage-picker" },
      el("label", { htmlFor: "passage", textContent: "Passage" }), select,
      el("span", { className: "or", textContent: "or" }),
      el("label", { htmlFor: "ref", className: "sr-only", textContent: "Reference" }), ref, go,
      el("span", { id: "ref-error", className: "note", role: "status" }));
  }

  /** A sample range for the box's placeholder, from the text's own first passages. */
  function refExample(passages) {
    const first = passages[0].passage;
    const later = passages[Math.min(3, passages.length - 1)].passage;
    return first === later ? first : `${first}-${later}`;
  }

  function setRefError(msg) {
    const e = $("ref-error");
    if (e) e.textContent = msg;
  }

  /** "◆ 1.2 — Προσλαμβανόμενος. ζῆτα ἐλλϊπὲς…" (notation shown as ♪; options can't use the notation font). */
  function optionLabel(p) {
    const mark = p.records.length ? "◆ " : "";
    const text = (p.row.cells || [p.row.text]).join(" ");
    const plain = AgmNotation.splitEmbeddedNotation(text).map((s) => (s.urn ? "♪" : s.text)).join("")
      .replace(/\s+/g, " ").trim();
    const preview = plain.length > 48 ? plain.slice(0, 47).trimEnd() + "…" : plain;
    return mark + (preview ? `${p.passage} — ${preview}` : p.passage);
  }

  /** Select one passage (by URN) of the current text, as from the menu. */
  function selectPassage(urn) {
    const select = $("passage");
    if (select) select.value = urn || "";
    const p = window.texts.passages.find((x) => x.urn === urn) || null;
    return showSelection(p ? [p] : [], p ? p.passage : "");
  }

  /** Select passages by a reference typed in the box ("1.1", "1", "1.1-1.4", "1-2.1"). */
  function selectReference(input) {
    const t = window.texts.text;
    const { passages, error } = AgmTexts.selectByReference(window.texts.passages, input, t && t.work);
    setRefError(error || "");
    if (error) return null;
    const select = $("passage");
    if (select) select.value = passages.length === 1 ? passages[0].urn : "";
    return showSelection(passages, String(input).trim());
  }

  /* ---------- the selected passages: their text, then their images ---------- */

  let imagePanel = null;
  let showToken = 0;   // ignore a slow image lookup once another image or selection is chosen
  let selectedUrns = []; // URNs of the selected passages, highlighted on the image

  /** Show the selected passages (`label`: how they were chosen) and the images indexed to them. */
  function showSelection(passages, label) {
    const out = $("passage-out");
    window.texts.selection = passages;
    window.texts.passage = passages.length === 1 ? passages[0] : null;
    selectedUrns = passages.map((p) => p.urn);
    if (!out) return passages;
    if (!passages.length) { out.replaceChildren(); imagePanel = null; return passages; }

    const head = passages.length === 1
      ? [el("h3", { textContent: passages[0].passage }),
         el("p", { className: "urn-line" }, el("code", { textContent: passages[0].urn }))]
      : [el("h3", { textContent: `${label} ` },
          el("span", { className: "count", textContent: `(${passages.length} passages: ${passages[0].passage} – ${passages[passages.length - 1].passage})` }))];
    const work = window.texts.text && window.texts.text.work;
    const body = passages.length === 1 ? cellsEl(passages[0].row)
      : AgmTexts.isSyllables(work) ? syllableLines(passages)
      : el("ol", { className: "selection" }, ...passages.map((p) => linked(el("li", { className: "sel-passage" + (p.records.length ? " has-roi" : "") },
          el("span", { className: "ref", textContent: p.passage, title: p.urn }), cellsEl(p.row)), p.urn)));

    const images = AgmTexts.imagesForPassages(passages);
    imagePanel = el("section", { className: "image-panel", id: "image-panel" });
    out.replaceChildren(...present(...head, body, imageChooser(images), imagePanel));
    window.texts.images = images;
    if (images.length) showImage(0);
    else imagePanel.replaceChildren(el("p", { className: "note muted",
      textContent: passages.length === 1 ? "No images are indexed to this passage." : "No images are indexed to these passages." }));
    return passages;
  }

  /**
   * Syllables shown as running text, one line per containing unit (1.1–1.5 on line "1", 2.1 on
   * line "2"). A syllable ending in "-" runs on into the next; others are followed by a space.
   * Each syllable is its own hover target, linked to its region.
   */
  function syllableLines(passages) {
    return el("ol", { className: "selection syllable-lines" },
      ...AgmTexts.groupByContainer(passages).map((g) => {
        const line = el("span", { className: "line-text greek" });
        g.passages.forEach((p, i) => {
          const text = (p.row.cells || [p.row.text]).join(" ");
          line.append(linked(el("span", { className: "sel-passage syl" + (p.records.length ? " has-roi" : ""),
            textContent: text, title: p.passage }), p.urn));
          if (i < g.passages.length - 1 && !/-$/.test(text)) line.append(" ");
        });
        return el("li", { className: "sel-line" },
          el("span", { className: "ref", textContent: g.container || "", title: g.passages.map((p) => p.passage).join(", ") }), line);
      }));
  }

  /** A row's cells side by side, with notation converted. */
  function cellsEl(row) {
    const body = el("div", { className: "cells" }, ...(row.cells || [row.text]).map(cellEl));
    if (row.cells) body.style.gridTemplateColumns = `repeat(${row.cells.length}, minmax(0, auto))`;
    return body;
  }

  /** When the selection is indexed on several images, buttons to choose one (else nothing). */
  function imageChooser(images) {
    if (images.length < 2) return null;
    return el("div", { className: "record-chooser" },
      el("span", { textContent: `On ${images.length} images: ` }),
      ...images.map((im, i) => {
        const src = AgmTexts.imageSource(window.texts.data, im.records[0]);
        const b = el("button", { type: "button", className: "record", textContent: src.label,
          title: `${im.imageUrn} (${im.records.length} passage${im.records.length === 1 ? "" : "s"})` });
        b.dataset.index = String(i);
        b.addEventListener("click", () => showImage(i));
        return b;
      }));
  }

  /** Show image `i` of the selection, with the selected passages' regions highlighted. */
  async function showImage(i) {
    const im = (window.texts.images || [])[i];
    if (!im || !imagePanel) return null;
    for (const b of document.querySelectorAll(".record-chooser .record")) b.classList.toggle("selected", b.dataset.index === String(i));
    const token = ++showToken;
    const panel = imagePanel;
    panel.replaceChildren(el("p", { className: "note muted", textContent: "Finding the image…" }));
    window.texts.viewer = null;

    const first = im.records[0];
    const img = await AgmTexts.resolveImage(window.texts.data, first, null, urnmapCache);
    if (token !== showToken) return null;
    if (img.error) {
      panel.replaceChildren(el("p", { className: "note", textContent: `Can't show the image: ${img.error}.` }));
      return img;
    }
    const focus = AgmTexts.unionRoi(im.records.map((r) => r.roi));
    const zoomBtn = el("button", { type: "button", textContent: im.records.length > 1 ? "Zoom to passages" : "Zoom to passage", disabled: !focus });
    const holder = el("div", { className: "viewer" });
    panel.replaceChildren(...present(
      el("div", { className: "image-head" },
        el("strong", { textContent: img.label }),
        el("code", { className: "meta", textContent: im.imageUrn }),
        el("span", { className: "image-actions" }, zoomBtn)),
      holder,
      img.credits ? el("p", { className: "credits", textContent: img.credits }) : null));

    const viewer = AgmViewer.createViewer(holder);
    window.texts.viewer = viewer;
    const work = window.texts.text && window.texts.text.work;
    viewer.setRegions(AgmTexts.imageRegions(window.texts.data, im.imageUrn, work));
    viewer.highlight(selectedUrns);
    // Hovering a region highlights it (and its passage in the list) while the pointer is there.
    viewer.onRegionHover((id) => hover(id));
    zoomBtn.addEventListener("click", () => viewer.focusRegion(focus, im.records.length > 1 ? 0.15 : 0.6));
    viewer.load(img.url, img.label);
    return img;
  }

  /** Temporarily highlight passage `urn` (region and list row); null returns to the selection. */
  function hover(urn) {
    if (window.texts.viewer) window.texts.viewer.highlight(urn || selectedUrns);
    for (const li of document.querySelectorAll("#passage-out .sel-passage")) {
      li.classList.toggle("hl", !!urn && li.dataset.urn === urn);
    }
  }

  /** Tag a list row with its passage URN so hovering it highlights its region. */
  function linked(node, urn) {
    node.dataset.urn = urn;
    node.addEventListener("pointerenter", () => hover(urn));
    node.addEventListener("pointerleave", () => hover(null));
    return node;
  }

  /** Text with Sowerby note URNs shown as Unicode signs in the notation font. */
  function cellEl(text) {
    const cell = el("span", { className: "cell greek" });
    for (const seg of AgmNotation.splitEmbeddedNotation(text)) {
      cell.append(seg.urn
        ? el("span", { className: "mousike-notation note-sign" + (seg.ok ? "" : " unknown"), textContent: seg.unicode, title: seg.urn })
        : seg.text);
    }
    return cell;
  }

  textSelect.addEventListener("change", () => selectText(textSelect.value));

  /* ---------- loading the release ---------- */

  function accept(d, source) {
    window.texts.data = d;
    setStatus(`Loaded mousike release ${d.version}`, false, `Source: ${source}`);
    renderMenu(d);
  }
  window.texts.accept = accept;

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

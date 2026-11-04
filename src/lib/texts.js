/*
 * texts.js — queries for agm-texts.html over a parsed mousike release (output of AgmCex.parseCex).
 *
 * The app works from both catalogs of texts:
 *   #!catalog_annotated  texts with musical annotation (e.g. Seikilos: notes, syllables, text)
 *   #!catalog_embedded   theoretical texts with notation embedded in them (e.g. Alypius)
 *
 * Classic UMD script: global `AgmTexts` in the browser (needs `AgmMss` and `AgmEdition` loaded
 * first), CommonJS in Node. Pure functions, apart from `resolveImage`, which fetches urnmaps.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./mss.js"), require("./edition.js"));
  } else {
    root.AgmTexts = factory(root.AgmMss, root.AgmEdition);
  }
})(typeof self !== "undefined" ? self : this, function (Mss, Edition) {
  "use strict";

  /** The two catalogs, in menu order, with a heading for each. */
  const CATALOGS = [
    { kind: "embedded", block: "catalog_embedded", heading: "Texts with embedded notation" },
    { kind: "annotated", block: "catalog_annotated", heading: "Texts with musical annotation" },
  ];

  /**
   * True for an edition of musical notation by itself: by convention, the version part of the
   * CTS work component is `notes` (e.g. "urn:cts:mousike:epigraphic.seikilos.notes").
   */
  function isNotation(work) {
    const parts = String(work || "").replace(/:$/, "").split(":");
    const id = parts.length >= 4 ? parts[3] : "";
    return id.split(".").pop() === "notes";
  }

  /** The version part of a CTS work component ("…seikilos.syllables" -> "syllables"). */
  function versionOf(work) {
    const parts = String(work || "").replace(/:$/, "").split(":");
    return parts.length >= 4 ? parts[3].split(".").pop() : "";
  }

  /** True for an edition cited by syllable: the version part of the work component is `syllables`. */
  function isSyllables(work) {
    return versionOf(work) === "syllables";
  }

  /** The reference of the unit containing passage `ref` ("1.4" -> "1"; "1" -> ""). */
  function containerOf(ref) {
    const parts = String(ref).split(".");
    return parts.length > 1 ? parts.slice(0, -1).join(".") : "";
  }

  /**
   * Group consecutive passages by their containing unit, keeping text order:
   * [{ container, passages }] (e.g. syllables 1.1–1.5 under "1", then 2.1 under "2").
   */
  function groupByContainer(passages) {
    const out = [];
    for (const p of passages) {
      const c = containerOf(p.passage);
      const last = out[out.length - 1];
      if (last && last.container === c) last.passages.push(p);
      else out.push({ container: c, passages: [p] });
    }
    return out;
  }

  /** Menu label for a catalog row: "Group, Title (version)", leaving out empty parts. */
  function catalogLabel(c) {
    const head = [c.groupName, c.workTitle].filter(Boolean).join(", ") || c.work || c.urn;
    return c.versionLabel ? `${head} (${c.versionLabel})` : head;
  }

  /**
   * One menu of texts from both catalogs: [{ urn, work, kind, heading, label, catalog }],
   * embedded texts first, then annotated, each in catalog order. `urn` is the catalog's
   * work-level URN (with its trailing colon); `work` is the same without it.
   * A work listed in both catalogs appears once, under the first. Editions of musical notation
   * by itself (see isNotation) are left out.
   */
  function textMenu(data) {
    const out = [];
    const seen = new Set();
    for (const cat of CATALOGS) {
      for (const c of data[cat.block] || []) {
        if (seen.has(c.work) || isNotation(c.work)) continue;
        seen.add(c.work);
        out.push({ urn: c.urn, work: c.work, kind: cat.kind, heading: cat.heading, label: catalogLabel(c), catalog: c });
      }
    }
    return out;
  }

  /**
   * The passages of one cataloged work, in source order, from whichever blocks cite it:
   * `#!texts_cols` for embedded texts; `#!texts`, `#!notes` and `#!syllables` for annotated ones.
   * Returns [{ urn, passage, block, row }].
   */
  function passagesFor(data, work) {
    const out = [];
    for (const block of ["texts_cols", "texts", "notes", "syllables"]) {
      for (const row of data[block] || []) {
        if (row.work === work) out.push({ urn: row.urn, passage: row.passage, block, row });
      }
    }
    return out;
  }

  /** "urn:cts:ns:work:passage" -> "urn:cts:ns:work" (null if not a CTS URN). */
  function ctsWork(urn) {
    const parts = String(urn || "").split(":");
    return parts.length >= 5 && parts[0] === "urn" && parts[1] === "cts" ? parts.slice(0, 4).join(":") : null;
  }

  /**
   * The passages of `work` for a menu, built from its text edition (see passagesFor), in text order,
   * each with the DSE records (from `data.dseAll`, every DSE record) that cite it, possibly none.
   * Returns [{ urn, passage, block, row, records: [dse rows] }].
   */
  function textPassages(data, work) {
    const byUrn = new Map();
    for (const r of data.dseAll || data.dse || []) {
      if (ctsWork(r.text) !== work) continue;
      if (!byUrn.has(r.text)) byUrn.set(r.text, []);
      byUrn.get(r.text).push(r);
    }
    return passagesFor(data, work).map((p) => ({ ...p, records: byUrn.get(p.urn) || [] }));
  }

  /* ---------- selecting passages by reference ---------- */

  /** Does passage reference `passage` fall under reference `ref` ("1" covers 1, 1.1, 1.1.2, …)? */
  function refMatches(passage, ref) {
    return passage === ref || String(passage).startsWith(ref + ".");
  }

  /**
   * Select passages by a citation reference, in text order: a single reference ("1.1"), a level of
   * the hierarchy ("1" = every passage under 1), or a range of either ("1.1-1.4", "1-2.1"): from the
   * first passage under the start through the last passage under the end.
   * `passages` are in text order (each with a `passage` reference); `work` (optional) lets a
   * reference be given as a full URN ("<work>:1.1"). Returns { passages, error }.
   */
  function selectByReference(passages, input, work) {
    let text = String(input || "").trim();
    if (work && text.startsWith(work + ":")) text = text.slice(work.length + 1);
    if (!text) return { passages: [], error: "Enter a reference, e.g. 1.1, 1, or 1.1-1.4" };
    const bounds = text.split("-").map((x) => x.trim());
    if (bounds.length > 2 || bounds.some((b) => !b)) {
      return { passages: [], error: `"${text}" is not a reference or a range of two references` };
    }
    const [from, to = from] = bounds;
    const start = passages.findIndex((p) => refMatches(p.passage, from));
    if (start < 0) return { passages: [], error: `No passage ${from} in this text` };
    let end = -1;
    for (let i = passages.length - 1; i >= 0; i--) if (refMatches(passages[i].passage, to)) { end = i; break; }
    if (end < 0) return { passages: [], error: `No passage ${to} in this text` };
    if (end < start) return { passages: [], error: `${to} comes before ${from} in this text` };
    return { passages: passages.slice(start, end + 1), error: null };
  }

  /* ---------- images for DSE records ---------- */

  /** The `#!mss` row whose collection URN begins `urn` (a page or surface URN), or null. */
  function manuscriptOf(data, urn) {
    const u = String(urn || "");
    return (data.mss || []).find((m) => {
      const prefix = String(m.urn || "").replace(/:?$/, ":");
      return prefix.length > 1 && u.startsWith(prefix);
    }) || null;
  }

  /**
   * Where the image cited by DSE record `dse` comes from, without fetching anything:
   *   { kind: "catalog", imageUrn, url, label, credits }  an `#!images` row with a `path`
   *   { kind: "iiif", imageUrn, ms, page, label }          a manuscript page: its `#!mss` row
   *        (found from the `#!mspages` row for the image, else from the DSE surface) gives the
   *        urnmap that maps the image URN to an IIIF Image service
   *   { kind: "unknown", imageUrn, label }                  neither
   */
  function imageSource(data, dse) {
    const imageUrn = Mss.imageBase(dse.image);
    const img = (data.images || []).find((r) => r.urn === imageUrn && r.path);
    if (img) {
      return { kind: "catalog", imageUrn, url: Edition.imageUrl(img), label: img.description || imageUrn, credits: img.credits || "" };
    }
    const page = (data.mspages || []).find((p) => p.image === imageUrn) || null;
    const ms = manuscriptOf(data, page ? page.urn : dse.surface);
    if (ms) return { kind: "iiif", imageUrn, ms, page, label: page ? page.label : ms.manuscript };
    return { kind: "unknown", imageUrn, label: imageUrn };
  }

  /**
   * Resolve DSE record `dse` to an image URL: { url, label, credits, source } or { error, source }.
   * IIIF images need the manuscript's urnmap; fetched urnmaps are kept in `cache` (a Map by URL).
   */
  async function resolveImage(data, dse, fetchImpl, cache) {
    const source = imageSource(data, dse);
    if (source.kind === "catalog") return { url: source.url, label: source.label, credits: source.credits, source };
    if (source.kind === "unknown") return { error: `no image source for ${source.imageUrn}`, source };
    const { ms } = source;
    if (!ms.urnmap) return { error: `#!mss has no urnmap for ${ms.manuscript}`, source };
    const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    try {
      let rows = cache && cache.get(ms.urnmap);
      if (!rows) {
        const res = await f(ms.urnmap);
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${ms.urnmap}`);
        rows = Mss.parseUrnMap(await res.text()).rows;
        if (cache) cache.set(ms.urnmap, rows);
      }
      const row = rows.find((r) => r.urn === source.imageUrn);
      if (!row) return { error: `${source.imageUrn} is not in the urnmap for ${ms.manuscript}`, source };
      return { url: Mss.iiifImageUrl(row.image, Mss.VIEW_SIZE), label: source.label, credits: "", source };
    } catch (e) {
      return { error: e.message, source };
    }
  }

  /**
   * The images that selected passages (each with `records`, as from textPassages) are indexed to,
   * in order of first appearance: [{ imageUrn, records: [dse rows on that image] }].
   */
  function imagesForPassages(passages) {
    const out = new Map();
    for (const p of passages) {
      for (const r of p.records || []) {
        const k = Mss.imageBase(r.image);
        if (!out.has(k)) out.set(k, { imageUrn: k, records: [] });
        out.get(k).records.push(r);
      }
    }
    return [...out.values()];
  }

  /** Smallest region containing all the given regions of interest (null if none). */
  function unionRoi(rois) {
    const rs = (rois || []).filter(Boolean);
    if (!rs.length) return null;
    const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.left + r.width)), bottom = Math.max(...rs.map((r) => r.top + r.height));
    return { left, top, width: right - left, height: bottom - top };
  }

  /**
   * Regions to draw on an image (URN without `@`): every DSE record on it with a region of
   * interest, as viewer regions { id: passage URN, roi, kind, title }. `kind` is "passage" for
   * passages of `work` and "other" for the rest.
   */
  function imageRegions(data, imageUrn, work) {
    return (data.dseAll || data.dse || [])
      .filter((r) => r.roi && Mss.imageBase(r.image) === imageUrn)
      .map((r) => {
        const w = ctsWork(r.text);
        return { id: r.text, roi: r.roi, kind: w === work ? "passage" : "other", title: w === work ? r.text.slice(w.length + 1) : r.text };
      });
  }

  return {
    CATALOGS, isNotation, catalogLabel, textMenu, passagesFor, ctsWork, textPassages,
    manuscriptOf, imageSource, resolveImage, imageRegions,
    refMatches, selectByReference, imagesForPassages, unionRoi,
    versionOf, isSyllables, containerOf, groupByContainer,
  };
});

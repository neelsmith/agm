/*
 * mss.js — manuscripts: the `#!mss` / `#!mspages` blocks of a mousike release, IIIF manifests,
 * and the delimited-text "urnmap" files that pair IIIF images with CITE2 URNs and labels.
 *
 * Classic UMD script: global `AgmMss` in the browser, CommonJS in Node. Pure functions only;
 * fetching is done by the app (or by `loadManuscript` with an injected fetch).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AgmMss = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const THUMB_WIDTH = 256;      // px width of light-table thumbnails
  const VIEW_SIZE = 2400;       // longest side, px, of the image shown in the pan/zoom viewer

  /** Manuscripts for a menu: [{ urn, label, manifest, urnmap }] in `#!mss` order. */
  function manuscriptMenu(data) {
    return (data.mss || []).map((m) => ({
      urn: m.urn, label: m.manuscript, manifest: m.manifest, urnmap: m.urnmap,
    }));
  }

  /** Normalise an IIIF Image service / image id for matching: no `/info.json`, no trailing `/`. */
  function serviceKey(id) {
    return String(id || "").trim().replace(/\/info\.json$/, "").replace(/\/+$/, "");
  }

  /**
   * Parse a urnmap file: `//` comment lines, then a header line, then `|`-delimited rows.
   * Returns { rows: [{ image, urn, label, … }], warnings }.
   */
  function parseUrnMap(text) {
    const warnings = [];
    const lines = String(text).replace(/^﻿/, "").split(/\r?\n/)
      .map((l) => l.replace(/\s+$/, ""))
      .filter((l) => l.trim() && !l.trim().startsWith("//"));
    if (!lines.length) return { rows: [], warnings: ["urnmap: no header line"] };
    const header = lines[0].split("|").map((h) => h.trim());
    for (const col of ["image", "urn", "label"]) {
      if (!header.includes(col)) warnings.push(`urnmap: header has no "${col}" column`);
    }
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("|");
      if (cols.length !== header.length) {
        warnings.push(`urnmap: row ${i} has ${cols.length} columns, expected ${header.length}`);
        continue;
      }
      const row = {};
      header.forEach((h, j) => (row[h] = cols[j].trim()));
      rows.push(row);
    }
    return { rows, warnings };
  }

  /** First value of a IIIF v3 language map, or a plain string label. */
  function labelText(label) {
    if (label == null) return "";
    if (typeof label === "string") return label;
    if (Array.isArray(label)) return labelText(label[0]);
    if (typeof label === "object") {
      if ("@value" in label) return String(label["@value"]);
      const vals = Object.values(label);
      return vals.length ? labelText(vals[0]) : "";
    }
    return String(label);
  }

  const first = (x) => (Array.isArray(x) ? x[0] : x);

  /**
   * The images of a IIIF Presentation manifest (v2 or v3), one per canvas, in order.
   * Returns [{ service, canvas, label, width, height }] where `service` is the IIIF Image
   * service id (or the image resource id if there is no service).
   */
  function manifestImages(manifest) {
    const out = [];
    if (!manifest || typeof manifest !== "object") return out;
    // v2: sequences[0].canvases[].images[0].resource
    const v2 = manifest.sequences && first(manifest.sequences);
    if (v2 && Array.isArray(v2.canvases)) {
      for (const c of v2.canvases) {
        const res = c.images && first(c.images) && first(c.images).resource;
        if (!res) continue;
        const svc = first(res.service);
        out.push({
          service: serviceKey((svc && (svc["@id"] || svc.id)) || res["@id"] || res.id),
          canvas: c["@id"] || c.id || null,
          label: labelText(c.label),
          width: c.width || res.width || null,
          height: c.height || res.height || null,
        });
      }
      return out;
    }
    // v3: items[] (Canvas) → items[0] (AnnotationPage) → items[0] (Annotation) → body
    for (const c of manifest.items || []) {
      const page = first(c.items);
      const anno = page && first(page.items);
      const body = anno && first(anno.body);
      if (!body) continue;
      const svc = first(body.service);
      out.push({
        service: serviceKey((svc && (svc.id || svc["@id"])) || body.id),
        canvas: c.id || null,
        label: labelText(c.label),
        width: c.width || body.width || null,
        height: c.height || body.height || null,
      });
    }
    return out;
  }

  /** IIIF Image API URL for `service`, scaled to fit within size×size (whole image, default quality). */
  function iiifImageUrl(service, size) {
    return `${serviceKey(service)}/full/!${size},${size}/0/default.jpg`;
  }

  /**
   * One light-table entry per manifest image, captioned from the urnmap row whose `image`
   * matches the image's service (caption "not found" when there is none). Pages from
   * `#!mspages` whose `image` equals the urnmap row's `urn` are attached as `page`.
   * `dseCounts` (from dseImageCounts) gives each entry `dse`: how many DSE records cite its URN.
   * Returns [{ service, label, found, urn, page, dse, manifestLabel, thumb, full, width, height }].
   */
  function lightTable(images, urnmapRows, mspages, dseCounts) {
    const byService = new Map();
    for (const r of urnmapRows || []) {
      const k = serviceKey(r.image);
      if (k && !byService.has(k)) byService.set(k, r);
    }
    const pageByImage = new Map();
    for (const p of mspages || []) if (p.image && !pageByImage.has(p.image)) pageByImage.set(p.image, p);
    return images.map((im) => {
      const row = byService.get(im.service) || null;
      return {
        service: im.service,
        label: row && row.label ? row.label : "not found",
        found: Boolean(row),
        urn: row ? row.urn : null,
        page: row ? pageByImage.get(row.urn) || null : null,
        dse: row && dseCounts ? dseCounts.get(row.urn) || 0 : 0,
        manifestLabel: im.label,
        thumb: iiifImageUrl(im.service, THUMB_WIDTH),
        full: iiifImageUrl(im.service, VIEW_SIZE),
        width: im.width,
        height: im.height,
      };
    });
  }

  /** An image URN without its `@` region of interest. */
  const imageBase = (urn) => String(urn || "").split("@")[0].trim();

  /** Number of DSE records citing each image (keyed by image URN without `@…`). */
  function dseImageCounts(dseRows) {
    const m = new Map();
    for (const r of dseRows || []) {
      const k = imageBase(r.image);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  /** "urn:cts:ns:work:passage" -> "urn:cts:ns:work" (null if not a CTS URN). */
  function ctsWork(urn) {
    const parts = String(urn || "").split(":");
    return parts.length >= 4 && parts[0] === "urn" && parts[1] === "cts" ? parts.slice(0, 4).join(":") : null;
  }

  /**
   * The DSE records agm-mss.html uses: those citing texts cataloged in `#!catalog_embedded`
   * (as agm-artifacts.html uses `#!catalog_annotated`). A release without that block uses all DSE records.
   */
  function embeddedDse(data) {
    const all = data.dseAll || data.dse || [];
    if (!data.catalogedEmbedded) return all;
    const works = new Set((data.catalog_embedded || []).map((c) => c.work));
    return all.filter((r) => works.has(ctsWork(r.text)));
  }

  /**
   * Passages indexed to one image (URN without `@`), in DSE order:
   * [{ urn, passage, roi, dse, row, catalog }] where `row` is the `#!texts_cols` row for the
   * passage (or null) and `catalog` its work's `#!catalog_embedded` row (or null).
   */
  function imagePassages(data, imageUrn) {
    const cols = (data.index && data.index.textsCols) || new Map();
    const cats = (data.index && data.index.catalogEmbedded) || new Map();
    return embeddedDse(data)
      .filter((r) => imageBase(r.image) === imageUrn)
      .map((r) => {
        const work = ctsWork(r.text);
        return {
          urn: r.text,
          passage: work ? r.text.slice(work.length + 1) : r.text,
          roi: r.roi || null,
          dse: r,
          row: cols.get(r.text) || null,
          catalog: (work && cats.get(work)) || null,
        };
      });
  }

  /** `#!mspages` rows belonging to manuscript `msUrn` (a collection URN such as "…mss.barocci41:"). */
  function pagesFor(data, msUrn) {
    const prefix = String(msUrn || "").replace(/:?$/, ":");
    return (data.mspages || []).filter((p) => String(p.urn).startsWith(prefix));
  }

  /**
   * Fetch a manuscript's manifest and urnmap and build its light table.
   * Images are matched with the DSE records from embeddedDse(data).
   * Returns { entries, counts: { images, found, missing, withDse }, warnings }.
   */
  async function loadManuscript(data, ms, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!f) throw new Error("No fetch implementation available");
    const get = async (url, what) => {
      if (!url) throw new Error(`${ms.label}: no ${what} URL in #!mss`);
      const res = await f(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${what} ${url}`);
      return res;
    };
    const [manifestRes, mapRes] = await Promise.all([get(ms.manifest, "manifest"), get(ms.urnmap, "urnmap")]);
    const manifest = await manifestRes.json();
    const map = parseUrnMap(await mapRes.text());
    const images = manifestImages(manifest);
    const dseRows = embeddedDse(data);
    const entries = lightTable(images, map.rows, pagesFor(data, ms.urn), dseImageCounts(dseRows));
    const found = entries.filter((e) => e.found).length;
    const withDse = entries.filter((e) => e.dse > 0).length;
    const warnings = map.warnings.slice();
    if (!images.length) warnings.push(`manifest ${ms.manifest}: no images found`);
    return { entries, counts: { images: entries.length, found, missing: entries.length - found, withDse }, warnings };
  }

  return {
    THUMB_WIDTH, VIEW_SIZE,
    manuscriptMenu, serviceKey, parseUrnMap, labelText, manifestImages, iiifImageUrl,
    lightTable, pagesFor, loadManuscript, imageBase, dseImageCounts, embeddedDse, imagePassages,
  };
});

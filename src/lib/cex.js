/*
 * cex.js — parse a `mousike` CEX release into plain JS data structures.
 *
 * Classic script (no ES modules) so the built app works from file://.
 * In the browser it defines a global `AgmCex`; in Node it is a CommonJS module.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AgmCex = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_URL =
    "https://raw.githubusercontent.com/neelsmith/mousike/refs/heads/main/releases/current.cex";

  const DELIMITER = "|";

  /** Expected column headers for each tabular block. */
  const BLOCK_SCHEMAS = {
    images: ["path", "description", "credits", "urn"],
    surfaces: ["urn", "label"],
    audio: ["file", "label", "notation"],
    catalog_annotated: ["urn", "citationScheme", "groupName", "workTitle", "versionLabel",
      "exemplarLabel", "online", "language"],
    catalog_embedded: ["urn", "citationScheme", "groupName", "workTitle", "versionLabel",
      "exemplarLabel", "online", "language"],
    mss: ["manuscript", "urn", "manifest", "urnmap"],
    texts: ["urn", "text"],
    // Parsed by parseTextsCols, not parseTable: `text` holds `columns` cells separated by "|".
    texts_cols: ["urn", "columns", "text"],
    notes: ["urn", "text"],
    syllables: ["urn", "text"],
    dse: ["image", "text", "surface"],
    mspages: ["urn", "label", "image"],
  };

  /** All blocks the app reads, in source order. */
  const BLOCK_NAMES = ["version"].concat(Object.keys(BLOCK_SCHEMAS));

  /** Blocks older releases may lack; their absence is handled, not reported as missing. */
  const OPTIONAL_BLOCKS = ["catalog_annotated", "catalog_embedded", "mss", "mspages", "texts_cols"];

  /**
   * Split raw CEX text into named blocks of non-empty lines.
   * Lines beginning with `//` are CEX comments and are skipped.
   * Lines before the first `#!` header are ignored.
   * @returns {Object<string, string[][]>} block name -> list of line arrays
   *   (a list of lists, because a block label may in principle repeat).
   */
  function splitBlocks(src) {
    const blocks = {};
    let current = null;
    const lines = String(src).replace(/^﻿/, "").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("#!")) {
        const name = line.slice(2).trim().toLowerCase();
        current = [];
        (blocks[name] = blocks[name] || []).push(current);
        continue;
      }
      if (current === null || line === "" || line.startsWith("//")) continue;
      current.push(raw.replace(/\s+$/, ""));
    }
    return blocks;
  }

  /**
   * Parse a delimited block whose first line is a header row.
   * Repeated blocks with the same name are concatenated.
   * Returns { rows, warnings } where rows are objects keyed by column name.
   */
  function parseTable(name, blockLists, warnings) {
    const expected = BLOCK_SCHEMAS[name];
    const rows = [];
    for (const lines of blockLists) {
      if (lines.length === 0) continue;
      const header = lines[0].split(DELIMITER).map((h) => h.trim());
      if (header.join("|") !== expected.join("|")) {
        warnings.push(
          `#!${name}: header "${header.join("|")}" differs from expected "${expected.join("|")}"`
        );
      }
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(DELIMITER);
        if (cols.length !== header.length) {
          warnings.push(
            `#!${name}: row ${i} has ${cols.length} columns, expected ${header.length}: ${lines[i]}`
          );
          continue;
        }
        const row = {};
        header.forEach((h, j) => (row[h] = cols[j].trim()));
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * Parse `#!texts_cols`: texts laid out in columns (e.g. a sign's name, its vocal and its
   * instrumental notation). Each line is `urn|columns|cell1|cell2|…`: the text after the
   * second delimiter is split into cells on "|" and should have `columns` cells. Repeated header
   * lines are skipped. Rows: { urn, columns (number), cells: [string], text (cells joined " | ") }.
   */
  function parseTextsCols(blockLists, warnings) {
    const expected = BLOCK_SCHEMAS.texts_cols.join("|");
    const rows = [];
    for (const lines of blockLists) {
      lines.forEach((line, i) => {
        const parts = line.split(DELIMITER);
        if (parts.map((p) => p.trim()).join("|") === expected) {
          if (i > 0) warnings.push(`#!texts_cols: repeated header line ${i} skipped`);
          return;
        }
        if (i === 0) warnings.push(`#!texts_cols: header "${line}" differs from expected "${expected}"`);
        const urn = parts[0].trim();
        const columns = Number(parts[1]);
        if (parts.length < 3 || !Number.isInteger(columns) || columns < 1) {
          warnings.push(`#!texts_cols: row ${i} needs urn|columns|text: ${line}`);
          return;
        }
        const cells = parts.slice(2).map((c) => c.trim());
        if (cells.length !== columns) {
          warnings.push(`#!texts_cols: ${urn} has ${cells.length} cell(s), expected ${columns}`);
        }
        rows.push({ urn, columns, cells, text: cells.join(" | ") });
      });
    }
    return rows;
  }

  /* ---------- URN helpers ---------- */

  /** Split a URN with an optional `@extension` (e.g. a CITE2 image ROI). */
  function splitExtension(urn) {
    const at = urn.indexOf("@");
    return at < 0
      ? { base: urn, extension: null }
      : { base: urn.slice(0, at), extension: urn.slice(at + 1) };
  }

  /**
   * Parse an image region of interest (four comma-separated fractions of image size)
   * or return null. Order is left,top,width,height: in the 2026a DSE data the first
   * value increases across a line of the stele and the second increases line by line.
   */
  function parseRoi(extension) {
    if (!extension) return null;
    const nums = extension.split(",").map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
    const [left, top, width, height] = nums;
    return { left, top, width, height };
  }

  /**
   * Parse a CITE2 URN: colon-separated parts
   *   urn:cite2:NAMESPACE:COLLECTION[.VERSION]:OBJECT[@EXTENSION]
   * The final part is the object identifier; it may carry `@` + a region of interest.
   * A URN with only four parts identifies a collection, not an object (object = null).
   * Returns null if the string is not a cite2 URN.
   */
  function parseCite2(urn) {
    const { base, extension } = splitExtension(String(urn).trim());
    const parts = base.split(":");
    if (parts.length < 4 || parts.length > 5 || parts[0] !== "urn" || parts[1] !== "cite2") {
      return null;
    }
    const [collection, ...ver] = parts[3].split(".");
    return {
      urn: base, // object (or collection) URN without the extension
      namespace: parts[2],
      collection,
      version: ver.length ? ver.join(".") : null,
      object: parts.length === 5 ? parts[4] : null,
      extension,
      roi: parseRoi(extension),
    };
  }

  /**
   * Find the catalog image for a (possibly ROI-extended) image URN.
   * Matches on namespace, collection and object; when the reference omits a version,
   * any version in the catalog matches. Returns the image row or null.
   */
  function resolveImage(images, ref) {
    const r = typeof ref === "string" ? parseCite2(ref) : ref;
    if (!r || !r.object) return null;
    for (const img of images) {
      const c = img.cite2;
      if (!c) continue;
      if (c.namespace === r.namespace && c.collection === r.collection && c.object === r.object &&
          (r.version === null || r.version === c.version)) {
        return img;
      }
    }
    return null;
  }

  /**
   * Split a CTS URN into work component and passage reference.
   * urn:cts:mousike:epigraphic.seikilos.text:1.2
   *   -> { work: "urn:cts:mousike:epigraphic.seikilos.text", passage: "1.2" }
   */
  function ctsParts(urn) {
    const parts = urn.split(":");
    if (parts.length < 4 || parts[0] !== "urn" || parts[1] !== "cts") {
      return { work: urn, passage: null };
    }
    if (parts.length === 4) return { work: urn, passage: null };
    return { work: parts.slice(0, 4).join(":"), passage: parts.slice(4).join(":") };
  }

  /**
   * Tokenize a line of notation: whitespace separates note groups;
   * `~` joins notes sung to a single syllable (melisma).
   */
  function tokenizeNotes(text) {
    return text
      .split(/\s+/)
      .filter(Boolean)
      .map((group) => group.split("~").filter(Boolean));
  }

  /**
   * Derive the 2-tier citation of a notes edition: a line `…notes:L` with groups
   * g1 g2 … yields one record per note group, cited `…notes:L.N` (N counts from 1),
   * analogous to syllables `…syllables:L.N`.
   * Each record: { urn, work, passage, line (URN of the line), group (N),
   *   notes: [note, …], text: notes joined with "~" }
   */
  function noteGroups(noteLines) {
    const out = [];
    for (const line of noteLines) {
      line.tokens.forEach((notes, i) => {
        const passage = `${line.passage}.${i + 1}`;
        out.push({
          urn: `${line.work}:${passage}`,
          work: line.work,
          passage,
          line: line.urn,
          group: i + 1,
          notes,
          text: notes.join("~"),
        });
      });
    }
    return out;
  }

  /** Build a Map from key column to row; warn on duplicate keys. */
  function indexBy(rows, key, name, warnings) {
    const m = new Map();
    for (const r of rows) {
      if (m.has(r[key])) warnings.push(`#!${name}: duplicate ${key} ${r[key]}`);
      m.set(r[key], r);
    }
    return m;
  }

  /* ---------- main entry point ---------- */

  /**
   * Parse a complete mousike CEX release.
   * @param {string} src raw CEX text
   * @returns {object} { version, images, surfaces, audio, catalog_annotated, texts, notes,
   *   syllables, dse, mspages, dseAll, index: {...Maps}, warnings: string[], cataloged: boolean }
   *
   * `dse` holds the DSE records for cataloged texts; `dseAll` holds every DSE record.
   *
   * Only texts cataloged in `#!catalog_annotated` are handled: rows of `#!texts`, `#!notes`,
   * `#!syllables`, DSE records citing a passage, and audio tracks whose notation URN is in a
   * work that isn't cataloged are dropped (one warning per work and block). A release with no
   * `#!catalog_annotated` block (before 2026h) keeps everything, with one warning;
   * `cataloged` is then false.
   */
  function parseCex(src) {
    const warnings = [];
    const blocks = splitBlocks(src);

    for (const name of BLOCK_NAMES) {
      if (!blocks[name] && !OPTIONAL_BLOCKS.includes(name)) warnings.push(`missing block #!${name}`);
    }
    for (const name of Object.keys(blocks)) {
      if (!BLOCK_NAMES.includes(name)) warnings.push(`unrecognized block #!${name} ignored`);
    }

    // 1. version: a single bare value
    const versionLines = (blocks.version || []).flat();
    const version = versionLines.length ? versionLines[0].trim() : null;
    if (versionLines.length > 1) warnings.push("#!version: more than one line; using the first");

    const table = (name) => parseTable(name, blocks[name] || [], warnings);

    const images = table("images").map((r) => {
      const cite2 = parseCite2(r.urn);
      if (!cite2 || !cite2.object) warnings.push(`#!images: not a CITE2 object URN: ${r.urn}`);
      return Object.assign(r, { cite2 });
    });
    const surfaces = table("surfaces");

    // Catalog of texts with musical annotation; URNs are work-level, e.g. "…seikilos.notes:".
    const cataloged = Boolean(blocks.catalog_annotated);
    const catalog_annotated = table("catalog_annotated").map((r) => {
      const { work } = ctsParts(r.urn);
      if (!/^urn:cts:/.test(r.urn)) warnings.push(`#!catalog_annotated: not a CTS URN: ${r.urn}`);
      return Object.assign(r, { work: work.replace(/:$/, ""), isOnline: r.online === "true" });
    });
    const catalogWorks = new Set(catalog_annotated.map((r) => r.work));
    if (!cataloged) {
      warnings.push("no #!catalog_annotated block: treating every text in the release as cataloged");
    }
    /** Keep rows whose CTS work (from `urnOf(row)`) is cataloged; warn once per dropped work. */
    const onlyCataloged = (name, rows, urnOf) => {
      if (!cataloged) return rows;
      const dropped = new Map();
      const kept = rows.filter((r) => {
        const { work } = ctsParts(String(urnOf(r) || ""));
        if (catalogWorks.has(work)) return true;
        dropped.set(work, (dropped.get(work) || 0) + 1);
        return false;
      });
      for (const [work, n] of dropped) {
        warnings.push(`#!${name}: ${n} row(s) for uncataloged ${work} ignored`);
      }
      return kept;
    };

    // Catalog of texts with embedded notation (2026h): theoretical texts quoting musical signs.
    // Only these works' `#!texts_cols` rows are kept. A release without the block keeps them all.
    const catalogedEmbedded = Boolean(blocks.catalog_embedded);
    const catalog_embedded = table("catalog_embedded").map((r) => {
      const { work } = ctsParts(r.urn);
      if (!/^urn:cts:/.test(r.urn)) warnings.push(`#!catalog_embedded: not a CTS URN: ${r.urn}`);
      return Object.assign(r, { work: work.replace(/:$/, ""), isOnline: r.online === "true" });
    });
    const embeddedWorks = new Set(catalog_embedded.map((r) => r.work));
    const texts_cols = parseTextsCols(blocks.texts_cols || [], warnings)
      .map((r) => Object.assign(r, ctsParts(r.urn)))
      .filter((r) => {
        if (!catalogedEmbedded || embeddedWorks.has(r.work)) return true;
        warnings.push(`#!texts_cols: uncataloged ${r.urn} ignored`);
        return false;
      });

    const audio = onlyCataloged("audio", table("audio"), (r) => r.notation);
    const texts = onlyCataloged("texts", table("texts"), (r) => r.urn)
      .map((r) => Object.assign(r, ctsParts(r.urn)));
    const notes = onlyCataloged("notes", table("notes"), (r) => r.urn).map((r) =>
      Object.assign(r, ctsParts(r.urn), { tokens: tokenizeNotes(r.text) })
    );
    const syllables = onlyCataloged("syllables", table("syllables"), (r) => r.urn)
      .map((r) => Object.assign(r, ctsParts(r.urn)));
    // All DSE records (kept as `dseAll`, e.g. for images in mss.html), and those for cataloged texts.
    const dseAll = table("dse").map((r) => {
      const cite2 = parseCite2(r.image);
      if (!cite2 || !cite2.object) {
        warnings.push(`#!dse: image is not a CITE2 object URN: ${r.image}`);
      } else if (cite2.extension && !cite2.roi) {
        warnings.push(`#!dse: unparseable region of interest: ${r.image}`);
      }
      return Object.assign(r, {
        imageObject: cite2 ? cite2.urn : null,
        roi: cite2 ? cite2.roi : null,
        cite2,
      });
    });
    const dse = onlyCataloged("dse", dseAll, (r) => r.text);

    // Manuscripts (2026h): a collection-level CITE2 URN, an IIIF manifest and a urnmap per manuscript,
    // and one row per page with its CITE2 URN, label and image URN.
    const mss = table("mss");
    const mspages = table("mspages");

    const index = {
      images: indexBy(images, "urn", "images", warnings),
      surfaces: indexBy(surfaces, "urn", "surfaces", warnings),
      texts: indexBy(texts, "urn", "texts", warnings),
      notes: indexBy(notes, "urn", "notes", warnings),
      syllables: indexBy(syllables, "urn", "syllables", warnings),
      // Cataloged works, keyed by work URN without passage ("urn:cts:ns:group.work.version")
      catalog: indexBy(catalog_annotated, "work", "catalog_annotated", warnings),
      catalogEmbedded: indexBy(catalog_embedded, "work", "catalog_embedded", warnings),
      textsCols: indexBy(texts_cols, "urn", "texts_cols", warnings),
      mss: indexBy(mss, "urn", "mss", warnings),
      mspages: indexBy(mspages, "urn", "mspages", warnings),
      // Derived from #!notes: one entry per note group, cited line.group
      noteGroups: indexBy(noteGroups(notes.filter((n) => n.passage)), "urn", "notes (groups)", warnings),
    };

    return {
      version, images, surfaces, audio, catalog_annotated, catalog_embedded, mss, texts, texts_cols,
      notes, syllables, dse, mspages, dseAll, index, warnings, cataloged, catalogedEmbedded,
    };
  }

  /** Fetch and parse a CEX release (browser or Node 18+). */
  async function loadCex(url, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!f) throw new Error("No fetch implementation available");
    const res = await f(url || DEFAULT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url || DEFAULT_URL}`);
    return parseCex(await res.text());
  }

  return {
    DEFAULT_URL,
    BLOCK_NAMES,
    BLOCK_SCHEMAS,
    OPTIONAL_BLOCKS,
    splitBlocks,
    parseTextsCols,
    splitExtension,
    parseRoi,
    parseCite2,
    resolveImage,
    ctsParts,
    tokenizeNotes,
    noteGroups,
    parseCex,
    loadCex,
  };
});

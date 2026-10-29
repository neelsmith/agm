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
    texts: ["urn", "text"],
    notes: ["urn", "text"],
    syllables: ["urn", "text"],
    dse: ["image", "text", "surface"],
  };

  /** All 8 blocks the app expects, in source order. */
  const BLOCK_NAMES = ["version"].concat(Object.keys(BLOCK_SCHEMAS));

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
   * @returns {object} { version, images, surfaces, audio, texts, notes,
   *   syllables, dse, index: {...Maps}, warnings: string[] }
   */
  function parseCex(src) {
    const warnings = [];
    const blocks = splitBlocks(src);

    for (const name of BLOCK_NAMES) {
      if (!blocks[name]) warnings.push(`missing block #!${name}`);
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
    const audio = table("audio");
    const texts = table("texts").map((r) => Object.assign(r, ctsParts(r.urn)));
    const notes = table("notes").map((r) =>
      Object.assign(r, ctsParts(r.urn), { tokens: tokenizeNotes(r.text) })
    );
    const syllables = table("syllables").map((r) => Object.assign(r, ctsParts(r.urn)));
    const dse = table("dse").map((r) => {
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

    const index = {
      images: indexBy(images, "urn", "images", warnings),
      surfaces: indexBy(surfaces, "urn", "surfaces", warnings),
      texts: indexBy(texts, "urn", "texts", warnings),
      notes: indexBy(notes, "urn", "notes", warnings),
      syllables: indexBy(syllables, "urn", "syllables", warnings),
    };

    return { version, images, surfaces, audio, texts, notes, syllables, dse, index, warnings };
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
    splitBlocks,
    splitExtension,
    parseRoi,
    parseCite2,
    resolveImage,
    ctsParts,
    tokenizeNotes,
    parseCex,
    loadCex,
  };
});

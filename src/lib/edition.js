/*
 * edition.js — queries over parsed mousike data (output of AgmCex.parseCex).
 *
 * Classic UMD script: global `AgmEdition` in the browser, CommonJS in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AgmEdition = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Surfaces for a menu: [{ urn, label }] in source order. */
  function surfaceMenu(data) {
    return data.surfaces.map((s) => ({ urn: s.urn, label: s.label }));
  }

  /** All DSE records whose surface column equals `surfaceUrn`, in source order. */
  function dseForSurface(data, surfaceUrn) {
    return data.dse.filter((r) => r.surface === surfaceUrn);
  }

  /**
   * Look up the passage a DSE text URN cites, in the `texts`, `notes` or `syllables` block.
   *
   * Notes are citable by line (`notes:1`) or by note group within a line (`notes:1.2`,
   * the 2nd whitespace-separated group); a group record also has `notes` (array) and `line`.
   *
   * Returns { urn, block, unit, match, record }:
   *   block  "texts" | "notes" | "syllables" | null
   *   unit   "line" | "group" | "syllable" | null
   *   match  "exact"     — the URN is in that block
   *          "container" — not found, but a containing passage is (e.g. text:1 for text:1.1);
   *                        `record` is the containing passage, for context only
   *          null        — nothing found; `record` is null
   */
  function resolvePassage(data, urn) {
    const blocks = [
      ["texts", "line", data.index.texts],
      ["notes", "line", data.index.notes],
      ["notes", "group", data.index.noteGroups],
      ["syllables", "syllable", data.index.syllables],
    ];
    for (const [block, unit, m] of blocks) {
      if (m.has(urn)) return { urn, block, unit, match: "exact", record: m.get(urn) };
    }
    // Walk up the citation hierarchy: a:1.2.3 -> a:1.2 -> a:1
    const colon = urn.lastIndexOf(":");
    if (colon > 0) {
      const work = urn.slice(0, colon);
      const ref = urn.slice(colon + 1).split(".");
      for (let n = ref.length - 1; n >= 1; n--) {
        const parent = `${work}:${ref.slice(0, n).join(".")}`;
        for (const [block, unit, m] of blocks) {
          if (m.has(parent)) return { urn, block, unit, match: "container", record: m.get(parent) };
        }
      }
    }
    return { urn, block: null, unit: null, match: null, record: null };
  }

  /**
   * Everything indexed to one surface: for each DSE record, the cited passage.
   * Returns { surface, entries: [{ dse, passage }], counts }
   */
  function surfaceContents(data, surfaceUrn) {
    const surface = data.index.surfaces.get(surfaceUrn) || null;
    const entries = dseForSurface(data, surfaceUrn).map((dse) => ({
      dse,
      passage: resolvePassage(data, dse.text),
    }));
    const counts = { total: entries.length, exact: 0, container: 0, missing: 0 };
    for (const e of entries) counts[e.passage.match || "missing"]++;
    return { surface, entries, counts };
  }

  return { surfaceMenu, dseForSurface, resolvePassage, surfaceContents };
});

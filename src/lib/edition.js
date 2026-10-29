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

  /* ---------- syllable ↔ note-group alignment ---------- */

  /**
   * The text a CTS work belongs to, without its last work-id component:
   * "urn:cts:mousike:epigraphic.seikilos.notes" -> "urn:cts:mousike:epigraphic.seikilos".
   * The notes and syllables editions of one text share this base.
   */
  function textBase(work) {
    const colon = work.lastIndexOf(":");
    const id = work.slice(colon + 1);
    const dot = id.lastIndexOf(".");
    return dot < 0 ? work : work.slice(0, colon + 1) + id.slice(0, dot);
  }

  /** Split a 2-tier passage "L.N" into { line: "L", n: N }; null if not 2-tier. */
  function splitLineRef(passage) {
    const parts = String(passage || "").split(".");
    if (parts.length !== 2 || !parts[0] || !/^\d+$/.test(parts[1])) return null;
    return { line: parts[0], n: Number(parts[1]) };
  }

  const byNumber = (a, b) => {
    const na = Number(a), nb = Number(b);
    return Number.isNaN(na) || Number.isNaN(nb) ? String(a).localeCompare(String(b)) : na - nb;
  };

  /**
   * Pair syllables with note groups line by line for one text.
   * `base` is a textBase() value. Line L's syllables (`…syllables:L.N`) and note groups
   * (`…notes:L.N`) are matched by N.
   * Returns [{ line, syllables: [rec], groups: [rec], columns: [{ n, syllable, group }],
   *   aligned }] in line order; a missing partner is null, and `aligned` is true when the
   *   line has the same number of syllables and note groups.
   */
  function alignLines(data, base) {
    const lines = new Map();
    const add = (rec, kind) => {
      if (textBase(rec.work) !== base) return;
      const ref = splitLineRef(rec.passage);
      if (!ref) return;
      if (!lines.has(ref.line)) lines.set(ref.line, { syllables: [], groups: [] });
      lines.get(ref.line)[kind].push({ n: ref.n, rec });
    };
    for (const s of data.syllables) add(s, "syllables");
    for (const g of data.index.noteGroups.values()) add(g, "groups");

    return [...lines.keys()].sort(byNumber).map((line) => {
      const { syllables, groups } = lines.get(line);
      const sylByN = new Map(syllables.map((x) => [x.n, x.rec]));
      const grpByN = new Map(groups.map((x) => [x.n, x.rec]));
      const ns = [...new Set([...sylByN.keys(), ...grpByN.keys()])].sort((a, b) => a - b);
      return {
        line,
        syllables: syllables.sort((a, b) => a.n - b.n).map((x) => x.rec),
        groups: groups.sort((a, b) => a.n - b.n).map((x) => x.rec),
        columns: ns.map((n) => ({ n, syllable: sylByN.get(n) || null, group: grpByN.get(n) || null })),
        aligned: syllables.length === groups.length,
      };
    });
  }

  /**
   * Texts a surface's DSE records cite, each with its aligned lines.
   * Returns [{ base, lines }] in order of first citation; texts with no syllables or
   * note groups are left out.
   */
  function surfaceLines(data, surfaceUrn) {
    const bases = [];
    for (const r of dseForSurface(data, surfaceUrn)) {
      const { work } = ctsWork(r.text);
      if (!work) continue;
      const b = textBase(work);
      if (!bases.includes(b)) bases.push(b);
    }
    return bases
      .map((base) => ({ base, lines: alignLines(data, base) }))
      .filter((t) => t.lines.length > 0);
  }

  /** "urn:cts:ns:work:passage" -> { work: "urn:cts:ns:work" } (work null if not CTS). */
  function ctsWork(urn) {
    const parts = String(urn || "").split(":");
    if (parts.length < 4 || parts[0] !== "urn" || parts[1] !== "cts") return { work: null };
    return { work: parts.slice(0, 4).join(":") };
  }

  return {
    surfaceMenu, dseForSurface, resolvePassage, surfaceContents,
    textBase, alignLines, surfaceLines,
  };
});

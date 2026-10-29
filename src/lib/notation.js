/*
 * notation.js — Greek musical notation in Zach Sowerby's URN scheme, rendered as Unicode.
 *
 * A JavaScript port of mousike's `note.py` / `unicode.py`; output should be identical.
 *
 * A note is cited by a URN in `urn:cite2:zst:` (the short form drops the prefix) with up to
 * five dot-separated tiers, e.g. `gvn:11.1.1.0.0`:
 *   1. base note
 *   2. sharpening (1 = unsharpened, 2 = first sharp, 3 = second sharp)
 *   3. length: 1 = no length sign, 2–5 = diseme, triseme, tetraseme, pentaseme
 *   4. arsis: 1 if the note carries an arsis dot (stigme), else 0
 *   5. hyphen: 1 if the note carries a hyphen, else 0 (not rendered)
 * Collections: `gvn` (vocal), `gin` (instrumental), `gcn` (other signs, e.g. the rest `gcn:1`,
 * which has a single tier).
 *
 * Rendering: the first two tiers choose the sign from Sowerby's table; length and arsis are
 * added as combining marks after the sign's first character (so on the letter, not the
 * prime, in upper-octave signs like `Ο′`). Groups are separated by one space; notes joined
 * with `~` (several notes over one syllable) are written with no space.
 *
 * Classic UMD script: global `AgmNotation` in the browser (needs `AgmSowerbyTable` loaded
 * first), CommonJS in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./sowerby-table.js"));
  } else {
    root.AgmNotation = factory(root.AgmSowerbyTable);
  }
})(typeof self !== "undefined" ? self : this, function (TABLE) {
  "use strict";

  const URN_PREFIX = "urn:cite2:zst:";
  const JOINER = "~";

  /** Combining marks for lengths 2–5. */
  const LENGTH_MARKS = {
    2: "̅",        // diseme: COMBINING OVERLINE
    3: "\u{1D242}",     // COMBINING GREEK MUSICAL TRISEME
    4: "\u{1D243}",     // COMBINING GREEK MUSICAL TETRASEME
    5: "\u{1D244}",     // COMBINING GREEK MUSICAL PENTASEME
  };
  const ARSIS_MARK = "̇"; // arsis dot (stigme): COMBINING DOT ABOVE

  function flag(value, tier, urn) {
    if (value !== "0" && value !== "1") {
      throw new Error(`${JSON.stringify(urn)}: ${tier} must be 0 or 1, not ${JSON.stringify(value)}`);
    }
    return value === "1";
  }

  /**
   * Parse one note URN (full or short form).
   * Returns a frozen object { collection, base, sharpening, length, arsis, hyphen, key,
   *   urn (short, all tiers), pitchUnicode, marks, unicode, name }.
   * Throws Error for a malformed URN or a sign not in the table.
   */
  function parseNote(urn) {
    let short = String(urn).trim();
    if (short.startsWith(URN_PREFIX)) short = short.slice(URN_PREFIX.length);
    const colon = short.indexOf(":");
    const collection = colon < 0 ? "" : short.slice(0, colon);
    const ref = colon < 0 ? "" : short.slice(colon + 1);
    if (!collection || !ref) throw new Error(`Not a note URN: ${JSON.stringify(urn)}`);
    const tiers = ref.split(".");
    if (tiers.length > 5 || !tiers.every((t) => /^\d+$/.test(t))) {
      throw new Error(`Not a note URN: ${JSON.stringify(urn)}`);
    }

    let key, sharpening;
    if (tiers.length >= 2 && Object.hasOwn(TABLE, `${collection}:${tiers[0]}.${tiers[1]}`)) {
      key = `${collection}:${tiers[0]}.${tiers[1]}`;
      sharpening = parseInt(tiers[1], 10);
    } else if (tiers.length === 1 && Object.hasOwn(TABLE, `${collection}:${tiers[0]}`)) {
      key = `${collection}:${tiers[0]}`;
      sharpening = null;
    } else {
      throw new Error(`No such note in the table: ${JSON.stringify(urn)}`);
    }

    const length = tiers.length > 2 ? parseInt(tiers[2], 10) : 1;
    if (length < 1 || length > 5) {
      throw new Error(`${JSON.stringify(urn)}: length must be 1-5, not ${length}`);
    }
    const arsis = tiers.length > 3 ? flag(tiers[3], "arsis", urn) : false;
    const hyphen = tiers.length > 4 ? flag(tiers[4], "hyphen", urn) : false;

    const [pitchUnicode, name] = TABLE[key];
    const marks = (LENGTH_MARKS[length] || "") + (arsis ? ARSIS_MARK : "");
    // Split by code point, not UTF-16 unit: many signs are astral (U+1D2xx).
    const chars = Array.from(pitchUnicode);
    const unicode = chars[0] + marks + chars.slice(1).join("");

    return Object.freeze({
      collection,
      base: parseInt(tiers[0], 10),
      sharpening,
      length,
      arsis,
      hyphen,
      key,
      urn: sharpening === null ? key : `${key}.${length}.${arsis ? 1 : 0}.${hyphen ? 1 : 0}`,
      pitchUnicode,
      marks,
      unicode,
      name,
      vocal: collection === "gvn",
      instrumental: collection === "gin",
    });
  }

  /** Unicode for a single note URN. noteToUnicode("gvn:11.1.1.0.0") === "Ϲ" */
  function noteToUnicode(urn) {
    return parseNote(urn).unicode;
  }

  /** Parse a notation string into note groups (arrays of parsed notes), one per syllable. */
  function parseNoteGroups(notes) {
    return String(notes)
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.split(JOINER).filter(Boolean).map(parseNote));
  }

  /** Render groups (arrays of URN strings or parsed notes): space between, none within. */
  function groupsToUnicode(groups) {
    return groups
      .map((g) => g.map((n) => (typeof n === "string" ? noteToUnicode(n) : n.unicode)).join(""))
      .join(" ");
  }

  /**
   * Convert a notation-edition string to Unicode.
   * notesToUnicode("gvn:11.1.1.0.0 gvn:13.3.1.0.0~gvn:14.1.1.0.0") === "Ϲ ΚΙ"
   */
  function notesToUnicode(notes) {
    return groupsToUnicode(parseNoteGroups(notes));
  }

  /** Like notesToUnicode but never throws: unknown notes render as `fallback(urn)`. */
  function notesToUnicodeSafe(notes, fallback) {
    const fb = fallback || ((u) => `[${u}]`);
    return String(notes)
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.split(JOINER).filter(Boolean).map((u) => {
        try { return noteToUnicode(u); } catch (e) { return fb(u); }
      }).join(""))
      .join(" ");
  }

  return {
    URN_PREFIX,
    LENGTH_MARKS,
    ARSIS_MARK,
    TABLE,
    parseNote,
    noteToUnicode,
    parseNoteGroups,
    groupsToUnicode,
    notesToUnicode,
    notesToUnicodeSafe,
  };
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const N = require("../lib/notation.js");

// Reference output from mousike's Python implementation (see src/tools/make-python-reference.py).
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "python-unicode.json"), "utf8"));

test("table has every sign (3 x 23 + 1 vocal, same instrumental, plus the rest)", () => {
  assert.equal(Object.keys(N.TABLE).length, 141);
});

test("matches mousike's Python output for every sign, length, arsis and hyphen", () => {
  const urns = Object.keys(ref.notes);
  assert.ok(urns.length > 3000);
  for (const urn of urns) assert.equal(N.noteToUnicode(urn), ref.notes[urn], urn);
});

test("rejects the same malformed URNs as the Python version", () => {
  for (const bad of ref.errors) assert.throws(() => N.noteToUnicode(bad), Error, bad);
});

test("matches Python for the Seikilos notation lines", () => {
  for (const [line, expected] of Object.entries(ref.lines)) {
    assert.equal(N.notesToUnicode(line), expected);
  }
});

test("examples from mousike's docs and tests", () => {
  assert.equal(N.noteToUnicode("gvn:1.1"), "\u{1D200}");
  assert.equal(N.noteToUnicode("gvn:11.1.1.0.0"), "Ϲ");
  assert.equal(N.noteToUnicode("urn:cite2:zst:gvn:11.1.1.0.0"), "Ϲ");
  assert.equal(N.noteToUnicode("gvn:19.1.1.0.0"), "Ο′");
  assert.equal(N.noteToUnicode("gcn:1"), "\u{1D245}");
  assert.notEqual(N.noteToUnicode("gin:1.1"), N.noteToUnicode("gvn:1.1"));
  assert.equal(N.notesToUnicode("gvn:11.1.1.0.0 gvn:13.3.1.0.0~gvn:14.1.1.0.0"), "Ϲ ΚΙ");
  assert.equal(
    N.notesToUnicode("gvn:11.1.1.0.0 gvn:15.1.2.0.0 gvn:15.1.3.1.0 " +
      "gvn:13.3.1.0.0~gvn:14.1.1.0.0~gvn:15.1.1.0.0 gvn:14.1.3.1.1"),
    "Ϲ Ζ̅ Ζ\u{1D242}̇ ΚΙΖ Ι\u{1D242}̇");
  assert.equal(N.notesToUnicode("  gvn:11.1.1.0.0\n\tgvn:12.1.1.0.0 "), "Ϲ Ο");
});

test("marks go after the first code point, even for astral signs with a prime", () => {
  // gin:22.2 is U+1D208 + PRIME; the triseme must not split the surrogate pair.
  assert.equal(N.noteToUnicode("gin:22.2.3.1.0"), "\u{1D208}\u{1D242}̇′");
});

test("parseNote exposes tiers, defaults and names", () => {
  const n = N.parseNote("gvn:14.1.3.1.1");
  assert.deepEqual([n.collection, n.base, n.sharpening, n.length, n.arsis, n.hyphen],
    ["gvn", 14, 1, 3, true, true]);
  assert.equal(n.name, "vocal d′");
  assert.equal(n.pitchUnicode, "Ι");
  const s = N.parseNote("gvn:11.1");
  assert.equal(s.urn, "gvn:11.1.1.0.0");
  const rest = N.parseNote("gcn:1");
  assert.equal(rest.sharpening, null);
  assert.equal(rest.name, "rest");
  assert.ok(Object.isFrozen(n));
});

test("groups: space between groups, none within", () => {
  const g = N.parseNoteGroups("gvn:11.1 gvn:13.3~gvn:14.1");
  assert.equal(g.length, 2);
  assert.equal(g[1].length, 2);
  assert.equal(N.groupsToUnicode([["gvn:11.1"], ["gvn:13.3", "gvn:14.1"]]), "Ϲ ΚΙ");
});

test("notesToUnicodeSafe marks unknown notes instead of throwing", () => {
  assert.equal(N.notesToUnicodeSafe("gvn:11.1 gvn:99.1"), "Ϲ [gvn:99.1]");
  assert.equal(N.notesToUnicodeSafe("gvn:99.1", () => "?"), "?");
});

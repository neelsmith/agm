const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cex = require("../lib/cex.js");
const ed = require("../lib/edition.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "current-2026a.cex"), "utf8");
const data = cex.parseCex(fixture);
const STELE = "urn:cite2:mousike:epigraphic.seikilos";

// Small well-formed release where every DSE text URN exists.
const small = cex.parseCex([
  "#!surfaces", "urn|label", "urn:cite2:t:obj.v1:a|Artifact A", "urn:cite2:t:obj.v1:b|Artifact B",
  "#!texts", "urn|text", "urn:cts:t:w.text:1|alpha beta",
  "#!notes", "urn|text", "urn:cts:t:w.notes:1|gvn:1.1.1.0.0 gvn:2.1.1.0.0",
  "#!dse", "image|text|surface",
  "urn:cite2:t:img.v1:x@0,0,.5,.5|urn:cts:t:w.notes:1|urn:cite2:t:obj.v1:a",
  "urn:cite2:t:img.v1:x@0,.5,.5,.5|urn:cts:t:w.text:1|urn:cite2:t:obj.v1:a",
  "urn:cite2:t:img.v1:y@0,0,1,1|urn:cts:t:w.text:1|urn:cite2:t:obj.v1:b",
].join("\n"));

test("2026c: DSE syllable references resolve in the syllables block", () => {
  const d = cex.parseCex(fs.readFileSync(path.join(__dirname, "fixtures", "current-2026c.cex"), "utf8"));
  assert.equal(d.version, "2026c");
  const r = ed.resolvePassage(d, "urn:cts:mousike:epigraphic.seikilos.syllables:1.4");
  assert.deepEqual([r.block, r.unit, r.match, r.record.text], ["syllables", "syllable", "exact", "φαι-"]);
  const s = ed.surfaceContents(d, STELE);
  // notes:1.x–4.x (20) + syllables:1.1–1.5 (5) resolve; notes:5.x–6.x (9) cite missing lines.
  assert.deepEqual(s.counts, { total: 34, exact: 25, container: 0, missing: 9 });
});

test("surfaceMenu lists surface labels with their URNs", () => {
  assert.deepEqual(ed.surfaceMenu(data), [
    { urn: STELE, label: "Copenhagen, Nationalmuseet 14897, the Seikilos stele" },
  ]);
  assert.equal(ed.surfaceMenu(small).length, 2);
});

test("dseForSurface filters on the surface column", () => {
  assert.equal(ed.dseForSurface(data, STELE).length, 34);
  assert.equal(ed.dseForSurface(small, "urn:cite2:t:obj.v1:a").length, 2);
  assert.equal(ed.dseForSurface(small, "urn:cite2:t:obj.v1:none").length, 0);
});

test("resolvePassage finds exact matches in texts and notes", () => {
  const t = ed.resolvePassage(small, "urn:cts:t:w.text:1");
  assert.equal(t.block, "texts");
  assert.equal(t.match, "exact");
  assert.equal(t.record.text, "alpha beta");
  const n = ed.resolvePassage(small, "urn:cts:t:w.notes:1");
  assert.equal(n.block, "notes");
  assert.equal(n.record.text, "gvn:1.1.1.0.0 gvn:2.1.1.0.0");
});

test("resolvePassage resolves notes line.group to a single note group", () => {
  const r = ed.resolvePassage(data, "urn:cts:mousike:epigraphic.seikilos.notes:1.1");
  assert.equal(r.match, "exact");
  assert.equal(r.block, "notes");
  assert.equal(r.unit, "group");
  assert.deepEqual(r.record.notes, ["gvn:11.1.1.0.0"]);
  const melisma = ed.resolvePassage(data, "urn:cts:mousike:epigraphic.seikilos.notes:1.4");
  assert.equal(melisma.record.notes.length, 3);
  // whole line still resolves as a line
  const line = ed.resolvePassage(data, "urn:cts:mousike:epigraphic.seikilos.notes:2");
  assert.equal(line.unit, "line");
  // group past the end of its line falls back to the line
  const past = ed.resolvePassage(data, "urn:cts:mousike:epigraphic.seikilos.notes:1.6");
  assert.equal(past.match, "container");
  assert.equal(past.record.urn, "urn:cts:mousike:epigraphic.seikilos.notes:1");
});

test("resolvePassage falls back to a containing passage, or reports missing", () => {
  const c = ed.resolvePassage(data, "urn:cts:mousike:epigraphic.seikilos.text:1.2");
  assert.equal(c.match, "container");
  assert.equal(c.block, "texts");
  assert.equal(c.record.urn, "urn:cts:mousike:epigraphic.seikilos.text:1");
  const m = ed.resolvePassage(data, "urn:cts:mousike:epigraphic.seikilos.notes:6.1");
  assert.equal(m.match, null);
  assert.equal(m.record, null);
});

test("surfaceContents pairs each DSE record with its passage", () => {
  const v = ed.surfaceContents(small, "urn:cite2:t:obj.v1:a");
  assert.equal(v.surface.label, "Artifact A");
  assert.deepEqual(v.entries.map((e) => e.passage.block), ["notes", "texts"]);
  assert.deepEqual(v.counts, { total: 2, exact: 2, container: 0, missing: 0 });

  // 2026a: notes:1.x–4.x resolve to note groups (20); text:1.x has only line-level
  // text:1 (5 container); notes:5.x–6.x cite lines that don't exist (9 missing).
  const s = ed.surfaceContents(data, STELE);
  assert.deepEqual(s.counts, { total: 34, exact: 20, container: 5, missing: 9 });
  assert.deepEqual(s.entries[3].passage.record.notes,
    ["gvn:13.3.1.0.0", "gvn:14.1.1.0.0", "gvn:15.1.1.0.0"]);
});

// Run with: node --test 'src/test/*.test.js'   (or `npm test` from src/)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cex = require("../lib/cex.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "current-2026a.cex"), "utf8");

const NO_CATALOG = "no #!catalog_annotated block: treating every text in the release as cataloged";

test("parses all 8 blocks of the 2026a release", () => {
  const d = cex.parseCex(fixture);
  assert.equal(d.version, "2026a");
  assert.equal(d.images.length, 1);
  assert.equal(d.surfaces.length, 1);
  assert.equal(d.audio.length, 3);
  assert.equal(d.texts.length, 4);
  assert.equal(d.notes.length, 4);
  assert.equal(d.syllables.length, 29);
  assert.equal(d.dse.length, 34);
  // Only problems in 2026a: DSE image URNs lack an object part (images.Seikilos2@…),
  // plus the notice that a pre-2026h release has no catalog.
  assert.equal(d.cataloged, false);
  assert.equal(d.warnings.length, 35);
  assert.equal(d.warnings.filter((w) => w.startsWith("#!dse: image is not a CITE2 object URN")).length, 34);
  assert.ok(d.warnings.includes(NO_CATALOG));
});

test("rows are keyed by column name and indexed by urn", () => {
  const d = cex.parseCex(fixture);
  const img = d.index.images.get("urn:cite2:mousike:images.v1:Seikilos2");
  assert.equal(img.path, "Seikilos2.png");
  assert.match(img.credits, /CC BY-SA 3\.0/);
  assert.equal(d.audio[0].notation, "urn:cts:mousike:epigraphic.seikilos.notes");
  assert.equal(d.index.texts.get("urn:cts:mousike:epigraphic.seikilos.text:1").text, "οσον ζης φαινου");
  assert.equal(d.index.syllables.get("urn:cts:mousike:epigraphic.seikilos.syllables:4.9").text, "τει");
});

test("CTS URNs split into work and passage", () => {
  assert.deepEqual(cex.ctsParts("urn:cts:mousike:epigraphic.seikilos.syllables:1.2"), {
    work: "urn:cts:mousike:epigraphic.seikilos.syllables",
    passage: "1.2",
  });
  assert.deepEqual(cex.ctsParts("urn:cts:mousike:epigraphic.seikilos.notes"), {
    work: "urn:cts:mousike:epigraphic.seikilos.notes",
    passage: null,
  });
});

test("notes tokenize into groups, with ~ joining a melisma", () => {
  const d = cex.parseCex(fixture);
  const n1 = d.notes[0].tokens;
  assert.equal(n1.length, 5);
  assert.deepEqual(n1[0], ["gvn:11.1.1.0.0"]);
  assert.deepEqual(n1[3], ["gvn:13.3.1.0.0", "gvn:14.1.1.0.0", "gvn:15.1.1.0.0"]);
});

test("tokenizeNotes: whitespace separates groups, ~ joins notes in a group", () => {
  assert.deepEqual(cex.tokenizeNotes("gvn:11.1.1.0.0 gvn:15.1.2.0.0 gvn:15.1.3.1.0"),
    [["gvn:11.1.1.0.0"], ["gvn:15.1.2.0.0"], ["gvn:15.1.3.1.0"]]);
  assert.deepEqual(cex.tokenizeNotes("gvn:13.3.1.0.0~gvn:14.1.1.0.0~gvn:15.1.1.0.0 gvn:14.1.3.1.1"),
    [["gvn:13.3.1.0.0", "gvn:14.1.1.0.0", "gvn:15.1.1.0.0"], ["gvn:14.1.3.1.1"]]);
});

test("notes lines yield note groups cited line.group", () => {
  const d = cex.parseCex(fixture);
  const g = d.index.noteGroups;
  assert.equal(g.size, 29); // 5 + 7 + 8 + 9 groups = number of syllables
  assert.equal(g.size, d.syllables.length);
  const g14 = g.get("urn:cts:mousike:epigraphic.seikilos.notes:1.4");
  assert.deepEqual(g14.notes, ["gvn:13.3.1.0.0", "gvn:14.1.1.0.0", "gvn:15.1.1.0.0"]);
  assert.equal(g14.text, "gvn:13.3.1.0.0~gvn:14.1.1.0.0~gvn:15.1.1.0.0");
  assert.equal(g14.line, "urn:cts:mousike:epigraphic.seikilos.notes:1");
  assert.equal(g14.group, 4);
  assert.deepEqual(g.get("urn:cts:mousike:epigraphic.seikilos.notes:4.9").notes,
    ["gvn:11.1.1.1.1", "gvn:9.3.2.1.1", "gvn:8.1.2.1.1"]);
  assert.equal(g.has("urn:cts:mousike:epigraphic.seikilos.notes:1.6"), false);
});

test("CITE2 URNs parse into parts, object id and region of interest", () => {
  assert.deepEqual(cex.parseCite2("urn:cite2:mousike:images.v1:Seikilos2@0.1164,0.4114,0.0412,0.0323"), {
    urn: "urn:cite2:mousike:images.v1:Seikilos2",
    namespace: "mousike",
    collection: "images",
    version: "v1",
    object: "Seikilos2",
    extension: "0.1164,0.4114,0.0412,0.0323",
    roi: { left: 0.1164, top: 0.4114, width: 0.0412, height: 0.0323 },
  });
  const noVersion = cex.parseCite2("urn:cite2:mousike:images:Seikilos2");
  assert.equal(noVersion.version, null);
  assert.equal(noVersion.object, "Seikilos2");
  assert.equal(noVersion.roi, null);
  // Four parts = a collection, not an object
  assert.equal(cex.parseCite2("urn:cite2:mousike:epigraphic.seikilos").object, null);
  assert.equal(cex.parseCite2("urn:cts:mousike:a.b:1"), null);
  assert.equal(cex.parseRoi("1,2,3"), null);
});

test("image references resolve to catalog entries by object id", () => {
  const d = cex.parseCex(fixture);
  const img = d.images[0];
  assert.equal(cex.resolveImage(d.images, "urn:cite2:mousike:images.v1:Seikilos2@0.1,0.2,0.3,0.4"), img);
  assert.equal(cex.resolveImage(d.images, "urn:cite2:mousike:images:Seikilos2"), img); // any version
  assert.equal(cex.resolveImage(d.images, "urn:cite2:mousike:images.v2:Seikilos2"), null);
  assert.equal(cex.resolveImage(d.images, d.dse[0].image), null); // 2026a DSE form
});

test("well-formed DSE rows get object URN and ROI without warnings", () => {
  const src = [
    "#!dse", "image|text|surface",
    "urn:cite2:mousike:images.v1:Seikilos2@0.1164,0.4114,0.0412,0.0323|urn:cts:mousike:x.y:1|urn:cite2:mousike:epigraphic.v1:seikilos",
  ].join("\n");
  const d = cex.parseCex(src);
  assert.equal(d.dse[0].imageObject, "urn:cite2:mousike:images.v1:Seikilos2");
  assert.deepEqual(d.dse[0].roi, { left: 0.1164, top: 0.4114, width: 0.0412, height: 0.0323 });
  assert.ok(!d.warnings.some((w) => w.startsWith("#!dse")));
});

test("tolerates CRLF, comments, blank lines, and reports problems", () => {
  const src = [
    "#!version", "2026x", "",
    "#!texts", "urn|text", "// a comment", "urn:cts:a:b.c:1|alpha", "bad row with|too|many",
    "#!bogus", "x",
  ].join("\r\n");
  const d = cex.parseCex(src);
  assert.equal(d.version, "2026x");
  assert.equal(d.texts.length, 1);
  assert.ok(d.warnings.some((w) => w.includes("missing block #!dse")));
  assert.ok(d.warnings.some((w) => w.includes("unrecognized block #!bogus")));
  assert.ok(d.warnings.some((w) => w.includes("3 columns")));
});

test("loadCex uses an injected fetch", async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => fixture });
  const d = await cex.loadCex("x", fakeFetch);
  assert.equal(d.version, "2026a");
  const bad = async () => ({ ok: false, status: 404 });
  await assert.rejects(cex.loadCex("x", bad), /HTTP 404/);
});

/* ---------- #!catalog_annotated: only cataloged texts are handled ---------- */

// Small invented release: one cataloged work set (w.notes, w.syllables) and an uncataloged
// work (other.text) with its own surface, DSE record and audio track.
const catalogedRelease = [
  "#!version", "test",
  "#!images", "path|description|credits|urn", "x.png|X|c|urn:cite2:t:img.v1:x",
  "#!surfaces", "urn|label", "urn:cite2:t:obj.v1:a|A", "urn:cite2:t:obj.v1:b|B",
  "#!audio", "file|label|notation", "a.wav|A|urn:cts:t:g.w.notes:1-2", "b.wav|B|urn:cts:t:g.other.text:1",
  "#!catalog_annotated",
  "urn|citationScheme|groupName|workTitle|versionLabel|exemplarLabel|online|language",
  "urn:cts:t:g.w.notes:|line|Group|Work|notation||true|grc",
  "urn:cts:t:g.w.syllables:|line/syllable|Group|Work|syllables||false|grc",
  "#!texts", "urn|text", "urn:cts:t:g.other.text:1|alpha",
  "#!notes", "urn|text", "urn:cts:t:g.w.notes:1|gvn:1.1.1.0.0",
  "#!syllables", "urn|text", "urn:cts:t:g.w.syllables:1.1|a", "urn:cts:t:g.other.syllables:1.1|b",
  "#!dse", "image|text|surface",
  "urn:cite2:t:img.v1:x@0,0,.1,.1|urn:cts:t:g.w.notes:1.1|urn:cite2:t:obj.v1:a",
  "urn:cite2:t:img.v1:x@0,0,.1,.1|urn:cts:t:g.other.text:1|urn:cite2:t:obj.v1:b",
].join("\n");

test("#!catalog_annotated is parsed and indexed by work", () => {
  const d = cex.parseCex(catalogedRelease);
  assert.equal(d.cataloged, true);
  assert.equal(d.catalog_annotated.length, 2);
  const c = d.index.catalog.get("urn:cts:t:g.w.notes");
  assert.equal(c.urn, "urn:cts:t:g.w.notes:");
  assert.equal(c.workTitle, "Work");
  assert.equal(c.citationScheme, "line");
  assert.equal(c.isOnline, true);
  assert.equal(d.index.catalog.get("urn:cts:t:g.w.syllables").isOnline, false);
});

test("rows for uncataloged works are dropped, with one warning per work and block", () => {
  const d = cex.parseCex(catalogedRelease);
  assert.deepEqual(d.texts, []);
  assert.deepEqual(d.syllables.map((r) => r.urn), ["urn:cts:t:g.w.syllables:1.1"]);
  assert.deepEqual(d.notes.map((r) => r.urn), ["urn:cts:t:g.w.notes:1"]);
  assert.deepEqual(d.dse.map((r) => r.text), ["urn:cts:t:g.w.notes:1.1"]);
  assert.deepEqual(d.audio.map((r) => r.file), ["a.wav"]);
  assert.deepEqual(d.warnings.sort(), [
    "#!audio: 1 row(s) for uncataloged urn:cts:t:g.other.text ignored",
    "#!dse: 1 row(s) for uncataloged urn:cts:t:g.other.text ignored",
    "#!syllables: 1 row(s) for uncataloged urn:cts:t:g.other.syllables ignored",
    "#!texts: 1 row(s) for uncataloged urn:cts:t:g.other.text ignored",
  ]);
  // surface B cites only the uncataloged text, so it drops out of the artifact menu
  const ed = require("../lib/edition.js");
  assert.deepEqual(ed.surfaceMenu(d).map((s) => s.label), ["A"]);
});

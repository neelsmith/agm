const test = require("node:test");
const assert = require("node:assert/strict");
const cex = require("../lib/cex.js");
const mss = require("../lib/mss.js");

// Invented release fragment and IIIF data (not the unpublished mousike draft).
const release = cex.parseCex([
  "#!mss", "manuscript|urn|manifest|urnmap",
  "Test Library, MS 1|urn:cite2:t:mss.ms1:|https://iiif.example/manifest.json|https://maps.example/ms1.cex",
  "#!mspages", "urn|label|image",
  "urn:cite2:t:mss.ms1:1r|Test Library, MS 1, fol. 1r|urn:cite2:t:img.v1:a",
  "urn:cite2:t:mss.ms1:1v|Test Library, MS 1, fol. 1v|urn:cite2:t:img.v1:b",
  "urn:cite2:t:mss.other:1r|Other, fol. 1r|urn:cite2:t:img.v1:z",
].join("\n"));

const URNMAP = [
  "// URN map for MS 1",
  "// manifest: https://iiif.example/manifest.json",
  "image|urn|label",
  "https://iiif.example/image/a|urn:cite2:t:img.v1:a|fol. 1r",
  "https://iiif.example/image/b/|urn:cite2:t:img.v1:b|fol. 1v",
  "https://iiif.example/image/c|urn:cite2:t:img.v1:c|fol. 2r",
].join("\n");

const canvasV2 = (id, label) => ({
  "@id": `https://iiif.example/canvas/${id}.json`, "@type": "sc:Canvas", label, width: 100, height: 150,
  images: [{ "@type": "oa:Annotation", resource: {
    "@id": `https://iiif.example/image/${id}`, "@type": "dctypes:Image",
    service: { "@id": `https://iiif.example/image/${id}`, profile: "http://iiif.io/api/image/2/level1.json" },
  } }],
});
const MANIFEST_V2 = {
  "@context": "http://iiif.io/api/presentation/2/context.json", "@type": "sc:Manifest",
  sequences: [{ canvases: [canvasV2("a", "fol. 1r"), canvasV2("b", "fol. 1v"), canvasV2("x", "Back cover")] }],
};
const MANIFEST_V3 = {
  "@context": "http://iiif.io/api/presentation/3/context.json", type: "Manifest",
  items: [{
    id: "https://iiif.example/canvas/a", type: "Canvas", label: { en: ["fol. 1r"] }, width: 100, height: 150,
    items: [{ type: "AnnotationPage", items: [{ type: "Annotation", body: {
      id: "https://iiif.example/image/a/full/max/0/default.jpg", type: "Image",
      service: [{ id: "https://iiif.example/image/a", type: "ImageService3" }],
    } }] }],
  }],
};

test("parseCex reads #!mss and #!mspages", () => {
  assert.equal(release.mss.length, 1);
  assert.equal(release.mss[0].manuscript, "Test Library, MS 1");
  assert.equal(release.mspages.length, 3);
  assert.ok(!release.warnings.some((w) => /#!mss|#!mspages/.test(w)));
});

test("manuscriptMenu lists manuscripts by name", () => {
  assert.deepEqual(mss.manuscriptMenu(release), [{
    urn: "urn:cite2:t:mss.ms1:", label: "Test Library, MS 1",
    manifest: "https://iiif.example/manifest.json", urnmap: "https://maps.example/ms1.cex",
  }]);
  assert.deepEqual(mss.manuscriptMenu({}), []);
});

test("parseUrnMap skips comments and keys rows by header", () => {
  const { rows, warnings } = mss.parseUrnMap(URNMAP);
  assert.deepEqual(warnings, []);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { image: "https://iiif.example/image/a", urn: "urn:cite2:t:img.v1:a", label: "fol. 1r" });
  assert.match(mss.parseUrnMap("image|urn|label\nx|y").warnings[0], /2 columns, expected 3/);
});

test("manifestImages reads IIIF v2 and v3 manifests", () => {
  const v2 = mss.manifestImages(MANIFEST_V2);
  assert.deepEqual(v2.map((i) => [i.service, i.label]), [
    ["https://iiif.example/image/a", "fol. 1r"],
    ["https://iiif.example/image/b", "fol. 1v"],
    ["https://iiif.example/image/x", "Back cover"],
  ]);
  const v3 = mss.manifestImages(MANIFEST_V3);
  assert.deepEqual(v3.map((i) => [i.service, i.label, i.width]), [["https://iiif.example/image/a", "fol. 1r", 100]]);
  assert.deepEqual(mss.manifestImages(null), []);
});

test("lightTable captions from the urnmap label, 'not found' otherwise, and attaches pages", () => {
  const entries = mss.lightTable(mss.manifestImages(MANIFEST_V2), mss.parseUrnMap(URNMAP).rows,
    mss.pagesFor(release, "urn:cite2:t:mss.ms1:"));
  assert.deepEqual(entries.map((e) => [e.label, e.found]), [["fol. 1r", true], ["fol. 1v", true], ["not found", false]]);
  assert.equal(entries[0].page.urn, "urn:cite2:t:mss.ms1:1r");
  assert.equal(entries[1].urn, "urn:cite2:t:img.v1:b"); // trailing "/" in the urnmap still matches
  assert.equal(entries[2].page, null);
  assert.equal(entries[0].thumb, "https://iiif.example/image/a/full/!256,256/0/default.jpg");
  assert.equal(entries[0].full, `https://iiif.example/image/a/full/!${mss.VIEW_SIZE},${mss.VIEW_SIZE}/0/default.jpg`);
});

test("pagesFor keeps only pages of the given manuscript", () => {
  assert.deepEqual(mss.pagesFor(release, "urn:cite2:t:mss.ms1:").map((p) => p.urn),
    ["urn:cite2:t:mss.ms1:1r", "urn:cite2:t:mss.ms1:1v"]);
});

test("loadManuscript fetches manifest and urnmap and counts matches", async () => {
  const responses = {
    "https://iiif.example/manifest.json": { ok: true, json: async () => MANIFEST_V2 },
    "https://maps.example/ms1.cex": { ok: true, text: async () => URNMAP },
  };
  const fetchStub = async (url) => responses[url] || { ok: false, status: 404 };
  const [ms] = mss.manuscriptMenu(release);
  const r = await mss.loadManuscript(release, ms, fetchStub);
  assert.deepEqual(r.counts, { images: 3, found: 2, missing: 1, withDse: 0 });
  await assert.rejects(mss.loadManuscript(release, { ...ms, urnmap: "https://nope" }, fetchStub), /HTTP 404/);
});

test("images cited by DSE records are counted, matching URNs without their @ROI", () => {
  const d = cex.parseCex([
    "#!dse", "image|text|surface",
    "urn:cite2:t:img.v1:a@0.1,0.1,0.2,0.2|urn:cts:t:uncataloged.text:1|urn:cite2:t:mss.ms1:1r",
    "urn:cite2:t:img.v1:a@0.5,0.5,0.2,0.2|urn:cts:t:uncataloged.text:2|urn:cite2:t:mss.ms1:1r",
    "urn:cite2:t:img.v1:c|urn:cts:t:uncataloged.text:3|urn:cite2:t:mss.ms1:2r",
    "#!catalog_annotated", "urn|citationScheme|groupName|workTitle|versionLabel|exemplarLabel|online|language",
    "urn:cts:t:other.notes:|line|G|W|V||true|grc",
  ].join("\n"));
  // the text isn't cataloged: agm's `dse` drops these records, `dseAll` keeps them
  assert.equal(d.dse.length, 0);
  assert.equal(d.dseAll.length, 3);
  const counts = mss.dseImageCounts(d.dseAll);
  assert.deepEqual([...counts], [["urn:cite2:t:img.v1:a", 2], ["urn:cite2:t:img.v1:c", 1]]);
  const entries = mss.lightTable(mss.manifestImages(MANIFEST_V2), mss.parseUrnMap(URNMAP).rows, [], counts);
  assert.deepEqual(entries.map((e) => [e.label, e.dse]), [["fol. 1r", 2], ["fol. 1v", 0], ["not found", 0]]);
});

test("loadManuscript counts images with DSE records from dseAll", async () => {
  const responses = {
    "https://iiif.example/manifest.json": { ok: true, json: async () => MANIFEST_V2 },
    "https://maps.example/ms1.cex": { ok: true, text: async () => URNMAP },
  };
  const data = { ...release, dseAll: [{ image: "urn:cite2:t:img.v1:b@0,0,1,1" }], dse: [] };
  const [ms] = mss.manuscriptMenu(release);
  const r = await mss.loadManuscript(data, ms, async (url) => responses[url]);
  assert.equal(r.counts.withDse, 1);
  assert.deepEqual(r.entries.map((e) => e.dse), [0, 1, 0]);
});

/* ---------- texts with embedded notation (#!catalog_embedded, #!texts_cols) ---------- */

const notation = require("../lib/notation.js");

// Invented release: one embedded-notation work (g.theory), one uncataloged work, two DSE records
// on image a (one for the uncataloged work) and a Seikilos-style cataloged-annotated record.
const embedded = cex.parseCex([
  "#!catalog_embedded", "urn|citationScheme|groupName|workTitle|versionLabel|exemplarLabel|online|language",
  "urn:cts:t:g.theory.ed:|section/paragraph|Theorist|On Signs|ed||true|grc",
  "#!texts_cols", "urn|columns|text", "urn|columns|text",
  "urn:cts:t:g.theory.ed:1.title|1|περὶ σημείων",
  "urn:cts:t:g.theory.ed:1.1|3|ζῆτα ἐλλιπές: | gvn:7.1.1.0.0 | gin:7.1.1.0.0",
  "urn:cts:t:g.theory.ed:1.2|3|X||",
  "urn:cts:t:g.theory.ed:1.3|3|too | few",
  "urn:cts:t:g.other.ed:1|1|not cataloged",
  "#!dse", "image|text|surface",
  "urn:cite2:t:img.v1:a@0.1,0.1,0.2,0.1|urn:cts:t:g.theory.ed:1.title|urn:cite2:t:mss.ms1:1r",
  "urn:cite2:t:img.v1:a@0.1,0.3,0.2,0.1|urn:cts:t:g.theory.ed:1.1|urn:cite2:t:mss.ms1:1r",
  "urn:cite2:t:img.v1:a@0.1,0.5,0.2,0.1|urn:cts:t:g.other.ed:1|urn:cite2:t:mss.ms1:1r",
  "urn:cite2:t:img.v1:b@0,0,1,1|urn:cts:t:g.theory.ed:9.9|urn:cite2:t:mss.ms1:1v",
].join("\n"));

test("#!texts_cols: cells split on |, repeated header skipped, uncataloged works dropped", () => {
  assert.equal(embedded.catalogedEmbedded, true);
  assert.equal(embedded.index.catalogEmbedded.get("urn:cts:t:g.theory.ed").workTitle, "On Signs");
  assert.deepEqual(embedded.texts_cols.map((r) => [r.passage, r.columns, r.cells]), [
    ["1.title", 1, ["περὶ σημείων"]],
    ["1.1", 3, ["ζῆτα ἐλλιπές:", "gvn:7.1.1.0.0", "gin:7.1.1.0.0"]],
    ["1.2", 3, ["X", "", ""]],
    ["1.3", 3, ["too", "few"]],
  ]);
  assert.ok(embedded.warnings.includes("#!texts_cols: repeated header line 1 skipped"));
  assert.ok(embedded.warnings.includes("#!texts_cols: urn:cts:t:g.theory.ed:1.3 has 2 cell(s), expected 3"));
  assert.ok(embedded.warnings.includes("#!texts_cols: uncataloged urn:cts:t:g.other.ed:1 ignored"));
});

test("splitEmbeddedNotation converts Sowerby URNs in running text", () => {
  const segs = notation.splitEmbeddedNotation("ταῦ gvn:7.1.1.0.0, gin:7.1.1.0.0. gvn:13.3.1.0.0~gvn:14.1.1.0.0 gvn:99.1 tlg2135.tlg001");
  assert.deepEqual(segs, [
    { text: "ταῦ " },
    { urn: "gvn:7.1.1.0.0", unicode: notation.noteToUnicode("gvn:7.1.1.0.0"), ok: true },
    { text: ", " },
    { urn: "gin:7.1.1.0.0", unicode: notation.noteToUnicode("gin:7.1.1.0.0"), ok: true },
    { text: ". " },
    { urn: "gvn:13.3.1.0.0~gvn:14.1.1.0.0", unicode: notation.notesToUnicode("gvn:13.3.1.0.0~gvn:14.1.1.0.0"), ok: true },
    { text: " " },
    { urn: "gvn:99.1", unicode: "[gvn:99.1]", ok: false },
    { text: " tlg2135.tlg001" },
  ]);
  assert.deepEqual(notation.splitEmbeddedNotation("plain"), [{ text: "plain" }]);
  assert.deepEqual(notation.splitEmbeddedNotation("urn:cite2:zst:gcn:1").map((s) => s.ok), [true]);
});

test("embeddedDse keeps DSE records for #!catalog_embedded texts", () => {
  assert.deepEqual(mss.embeddedDse(embedded).map((r) => r.text), [
    "urn:cts:t:g.theory.ed:1.title", "urn:cts:t:g.theory.ed:1.1", "urn:cts:t:g.theory.ed:9.9",
  ]);
});

test("imagePassages lists the passages on an image with their texts_cols rows", () => {
  const ps = mss.imagePassages(embedded, "urn:cite2:t:img.v1:a");
  assert.deepEqual(ps.map((p) => [p.passage, p.row && p.row.columns, p.catalog.workTitle]),
    [["1.title", 1, "On Signs"], ["1.1", 3, "On Signs"]]);
  assert.deepEqual(ps[1].roi, { left: 0.1, top: 0.3, width: 0.2, height: 0.1 });
  const missing = mss.imagePassages(embedded, "urn:cite2:t:img.v1:b");
  assert.equal(missing[0].row, null); // passage 9.9 isn't in #!texts_cols
  assert.deepEqual(mss.imagePassages(embedded, "urn:cite2:t:img.v1:none"), []);
});

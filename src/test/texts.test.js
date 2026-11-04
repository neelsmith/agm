const test = require("node:test");
const assert = require("node:assert/strict");
const cex = require("../lib/cex.js");
const texts = require("../lib/texts.js");

const HEAD = "urn|citationScheme|groupName|workTitle|versionLabel|exemplarLabel|online|language";
// Invented release with both catalogs (the order of rows within each catalog is kept).
const d = cex.parseCex([
  "#!catalog_annotated", HEAD,
  "urn:cts:t:epi.song.notes:|line|Inscriptions|A Song|notation by line||true|grc",
  "urn:cts:t:epi.song.syllables:|line/syllable|Inscriptions|A Song|syllables||true|grc",
  "#!catalog_embedded", HEAD,
  "urn:cts:t:g.theory.ed:|section|Theorist|On Signs|ed||true|grc",
  "urn:cts:t:g.canon.ed:|section|Geometer|Canon||||grc",
  "#!notes", "urn|text", "urn:cts:t:epi.song.notes:1|gvn:1.1.1.0.0 gvn:2.1.1.0.0",
  "#!syllables", "urn|text", "urn:cts:t:epi.song.syllables:1.1|a", "urn:cts:t:epi.song.syllables:1.2|b",
  "#!texts_cols", "urn|columns|text",
  "urn:cts:t:g.theory.ed:1|1|περὶ σημείων gvn:7.1.1.0.0", "urn:cts:t:g.theory.ed:2|3|a | b | c",
].join("\n"));

test("textMenu lists embedded then annotated texts, each in catalog order", () => {
  const menu = texts.textMenu(d);
  assert.deepEqual(menu.map((t) => [t.kind, t.work, t.label]), [
    ["embedded", "urn:cts:t:g.theory.ed", "Theorist, On Signs (ed)"],
    ["embedded", "urn:cts:t:g.canon.ed", "Geometer, Canon"],
    // (the notation-only edition urn:cts:t:epi.song.notes is left out)
    ["annotated", "urn:cts:t:epi.song.syllables", "Inscriptions, A Song (syllables)"],
  ]);
  assert.equal(menu[0].urn, "urn:cts:t:g.theory.ed:");
  assert.equal(menu[0].heading, "Texts with embedded notation");
  assert.equal(menu[2].catalog.citationScheme, "line/syllable");
});

test("textMenu: a work in both catalogs is listed once; no catalogs → empty menu", () => {
  const both = cex.parseCex(["#!catalog_annotated", HEAD, "urn:cts:t:x.y.z:|line|G|W|||true|grc",
    "#!catalog_embedded", HEAD, "urn:cts:t:x.y.z:|line|G|W|||true|grc"].join("\n"));
  assert.deepEqual(texts.textMenu(both).map((t) => t.kind), ["embedded"]);
  assert.deepEqual(texts.textMenu(cex.parseCex("#!version\nold")), []);
});

test("passagesFor finds a work's passages in whichever block cites it", () => {
  assert.deepEqual(texts.passagesFor(d, "urn:cts:t:g.theory.ed").map((p) => [p.block, p.passage]),
    [["texts_cols", "1"], ["texts_cols", "2"]]);
  assert.deepEqual(texts.passagesFor(d, "urn:cts:t:epi.song.syllables").map((p) => p.passage), ["1.1", "1.2"]);
  assert.equal(texts.passagesFor(d, "urn:cts:t:epi.song.notes")[0].block, "notes");
  assert.deepEqual(texts.passagesFor(d, "urn:cts:t:g.canon.ed"), []);
});

/* ---------- notation-only editions; passages in the DSE index ---------- */

test("isNotation: the version part of the work component is `notes`", () => {
  assert.equal(texts.isNotation("urn:cts:mousike:epigraphic.seikilos.notes"), true);
  assert.equal(texts.isNotation("urn:cts:mousike:epigraphic.seikilos.notes:"), true);
  assert.equal(texts.isNotation("urn:cts:mousike:epigraphic.seikilos.syllables"), false);
  assert.equal(texts.isNotation("urn:cts:t:notes.x.text"), false);
});

test("textMenu leaves out notation-only editions", () => {
  assert.ok(!texts.textMenu(d).some((t) => t.work === "urn:cts:t:epi.song.notes"));
  assert.deepEqual(texts.textMenu(d).map((t) => t.work), [
    "urn:cts:t:g.theory.ed", "urn:cts:t:g.canon.ed", "urn:cts:t:epi.song.syllables",
  ]);
});

test("textPassages: every passage of the text edition, with the DSE records citing it", () => {
  const withDse = cex.parseCex([
    "#!catalog_embedded", HEAD, "urn:cts:t:g.theory.ed:|section|Theorist|On Signs|ed||true|grc",
    "#!texts_cols", "urn|columns|text",
    "urn:cts:t:g.theory.ed:1|1|one", "urn:cts:t:g.theory.ed:2|1|two", "urn:cts:t:g.theory.ed:3|1|three",
    "#!dse", "image|text|surface",
    "urn:cite2:t:img.v1:a@0,0,.1,.1|urn:cts:t:g.theory.ed:3|urn:cite2:t:ms.v1:1r",
    "urn:cite2:t:img.v1:a@0,.2,.1,.1|urn:cts:t:g.theory.ed:1|urn:cite2:t:ms.v1:1r",
    "urn:cite2:t:img.v1:b@0,0,.1,.1|urn:cts:t:g.theory.ed:1|urn:cite2:t:ms.v1:1v",
    "urn:cite2:t:img.v1:b@0,.2,.1,.1|urn:cts:t:g.theory.ed:9|urn:cite2:t:ms.v1:1v",
    "urn:cite2:t:img.v1:b@0,.4,.1,.1|urn:cts:t:other.work.ed:1|urn:cite2:t:ms.v1:1v",
  ].join("\n"));
  const ps = texts.textPassages(withDse, "urn:cts:t:g.theory.ed");
  // passage 2 has no DSE record; DSE-cited 9 isn't in the text, so it isn't listed
  assert.deepEqual(ps.map((p) => [p.passage, p.records.length, p.row.text, p.block]),
    [["1", 2, "one", "texts_cols"], ["2", 0, "two", "texts_cols"], ["3", 1, "three", "texts_cols"]]);
  assert.deepEqual(texts.textPassages(withDse, "urn:cts:t:nothing.here.ed"), []);
});

/* ---------- images for a passage's DSE records ---------- */

// Invented release: a catalogued image (path) and a manuscript page (IIIF via urnmap).
const imgs = cex.parseCex([
  "#!images", "path|description|credits|urn",
  "stone.png|A stone|Photo: someone|urn:cite2:t:images.v1:stone",
  "#!catalog_embedded", HEAD, "urn:cts:t:g.theory.ed:|section|Theorist|On Signs|ed||true|grc",
  "#!mss", "manuscript|urn|manifest|urnmap",
  "Test Library, MS 1|urn:cite2:t:mss.ms1:|https://iiif.example/manifest.json|https://maps.example/ms1.cex",
  "#!mspages", "urn|label|image", "urn:cite2:t:mss.ms1:2r|Test Library, MS 1, fol. 2r|urn:cite2:t:lib.v1:p2r",
  "#!texts_cols", "urn|columns|text", "urn:cts:t:g.theory.ed:1|1|one", "urn:cts:t:g.theory.ed:2|1|two",
  "#!dse", "image|text|surface",
  "urn:cite2:t:lib.v1:p2r@0.1,0.2,0.3,0.05|urn:cts:t:g.theory.ed:1|urn:cite2:t:mss.ms1:2r",
  "urn:cite2:t:lib.v1:p2r@0.1,0.3,0.3,0.05|urn:cts:t:g.theory.ed:2|urn:cite2:t:mss.ms1:2r",
  "urn:cite2:t:lib.v1:p2r@0.5,0.5,0.1,0.1|urn:cts:t:other.work.ed:7|urn:cite2:t:mss.ms1:2r",
  "urn:cite2:t:images.v1:stone@0,0,.5,.5|urn:cts:t:g.theory.ed:2|urn:cite2:t:stones.v1:a",
  "urn:cite2:t:lib.v1:nowhere@0,0,1,1|urn:cts:t:g.theory.ed:1|urn:cite2:t:unknown.v1:x",
].join("\n"));
const URNMAP1 = "// map\nimage|urn|label\nhttps://iiif.example/image/p2r|urn:cite2:t:lib.v1:p2r|fol. 2r\n";

test("imageSource: catalogued image, manuscript page, or unknown", () => {
  const [onPage, , , onStone, nowhere] = imgs.dseAll;
  const s1 = texts.imageSource(imgs, onPage);
  assert.deepEqual([s1.kind, s1.imageUrn, s1.ms.manuscript, s1.label],
    ["iiif", "urn:cite2:t:lib.v1:p2r", "Test Library, MS 1", "Test Library, MS 1, fol. 2r"]);
  const s2 = texts.imageSource(imgs, onStone);
  assert.deepEqual([s2.kind, s2.label, s2.credits], ["catalog", "A stone", "Photo: someone"]);
  assert.match(s2.url, /\/stone\.png$/);
  assert.equal(texts.imageSource(imgs, nowhere).kind, "unknown");
});

test("resolveImage fetches the manuscript's urnmap once and builds an IIIF URL", async () => {
  let fetches = 0;
  const fetchStub = async (url) => { fetches++; return url === "https://maps.example/ms1.cex" ? { ok: true, text: async () => URNMAP1 } : { ok: false, status: 404 }; };
  const cache = new Map();
  const r = await texts.resolveImage(imgs, imgs.dseAll[0], fetchStub, cache);
  assert.equal(r.url, "https://iiif.example/image/p2r/full/!2400,2400/0/default.jpg");
  assert.equal(r.label, "Test Library, MS 1, fol. 2r");
  await texts.resolveImage(imgs, imgs.dseAll[1], fetchStub, cache);
  assert.equal(fetches, 1); // cached
  assert.match((await texts.resolveImage(imgs, imgs.dseAll[4], fetchStub, cache)).error, /no image source/);
  const noMap = { ...imgs, mss: [{ manuscript: "Test Library, MS 1", urn: "urn:cite2:t:mss.ms1:" }] };
  assert.match((await texts.resolveImage(noMap, imgs.dseAll[0], fetchStub, new Map())).error, /no urnmap/);
});

test("imageRegions: all regions on an image, the work's passages marked", () => {
  const regs = texts.imageRegions(imgs, "urn:cite2:t:lib.v1:p2r", "urn:cts:t:g.theory.ed");
  assert.deepEqual(regs.map((r) => [r.title, r.kind]), [["1", "passage"], ["2", "passage"], ["urn:cts:t:other.work.ed:7", "other"]]);
  assert.deepEqual(regs[0].roi, { left: 0.1, top: 0.2, width: 0.3, height: 0.05 });
});

/* ---------- selecting passages by reference ---------- */

// Seikilos-like syllables: lines 1 (5 syllables) and 2 (3), plus non-numeric refs as in Alypius.
const refs = ["1.1", "1.2", "1.3", "1.4", "1.5", "2.1", "2.2", "2.3", "preface.title", "preface.1", "10.1"]
  .map((r) => ({ passage: r, urn: `urn:cts:t:w.syl:${r}`, records: [] }));
const sel = (input) => {
  const r = texts.selectByReference(refs, input, "urn:cts:t:w.syl");
  return r.error ? r.error : r.passages.map((p) => p.passage).join(" ");
};

test("selectByReference: single reference, level, and ranges at any level", () => {
  assert.equal(sel("1.1"), "1.1");
  assert.equal(sel("1.1-1.4"), "1.1 1.2 1.3 1.4");
  assert.equal(sel("1"), "1.1 1.2 1.3 1.4 1.5");
  assert.equal(sel("1-2.1"), "1.1 1.2 1.3 1.4 1.5 2.1");
  assert.equal(sel("1.4-2"), "1.4 1.5 2.1 2.2 2.3");
  assert.equal(sel(" 1 - 2 "), "1.1 1.2 1.3 1.4 1.5 2.1 2.2 2.3");
  assert.equal(sel("preface"), "preface.title preface.1");
  assert.equal(sel("urn:cts:t:w.syl:2.2"), "2.2"); // full URN accepted
  assert.equal(sel("1"), sel("1-1"));
  // "1" must not match "10.1"
  assert.ok(!sel("1").includes("10.1"));
});

test("selectByReference: errors", () => {
  assert.match(sel(""), /Enter a reference/);
  assert.match(sel("3"), /No passage 3/);
  assert.match(sel("1.1-9"), /No passage 9/);
  assert.match(sel("2.1-1.2"), /1\.2 comes before 2\.1/);
  assert.match(sel("1-2-3"), /not a reference or a range/);
  assert.match(sel("1-"), /not a reference or a range/);
});

test("imagesForPassages groups the selection's DSE records by image; unionRoi bounds them", () => {
  const ps = [
    { records: [{ image: "urn:cite2:t:i.v1:a@0.1,0.1,0.2,0.1", roi: { left: 0.1, top: 0.1, width: 0.2, height: 0.1 } }] },
    { records: [] },
    { records: [{ image: "urn:cite2:t:i.v1:b@0,0,1,1", roi: null },
                { image: "urn:cite2:t:i.v1:a@0.4,0.5,0.1,0.1", roi: { left: 0.4, top: 0.5, width: 0.1, height: 0.1 } }] },
  ];
  const ims = texts.imagesForPassages(ps);
  assert.deepEqual(ims.map((i) => [i.imageUrn, i.records.length]), [["urn:cite2:t:i.v1:a", 2], ["urn:cite2:t:i.v1:b", 1]]);
  const u = texts.unionRoi(ims[0].records.map((r) => r.roi));
  assert.deepEqual([u.left, u.top].map((x) => +x.toFixed(6)), [0.1, 0.1]);
  assert.deepEqual([u.width, u.height].map((x) => +x.toFixed(6)), [0.4, 0.5]);
  assert.equal(texts.unionRoi([null]), null);
});

test("syllable editions: containing units group passages into lines", () => {
  assert.equal(texts.isSyllables("urn:cts:mousike:epigraphic.seikilos.syllables"), true);
  assert.equal(texts.isSyllables("urn:cts:greekLit:tlg2135.tlg001.mousike"), false);
  assert.equal(texts.versionOf("urn:cts:mousike:epigraphic.seikilos.notes:"), "notes");
  assert.equal(texts.containerOf("1.4"), "1");
  assert.equal(texts.containerOf("1.2.3"), "1.2");
  assert.equal(texts.containerOf("1"), "");
  const groups = texts.groupByContainer(texts.selectByReference(refs, "1-2.1").passages);
  assert.deepEqual(groups.map((g) => [g.container, g.passages.map((p) => p.passage)]),
    [["1", ["1.1", "1.2", "1.3", "1.4", "1.5"]], ["2", ["2.1"]]]);
});

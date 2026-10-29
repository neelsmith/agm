const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../lib/viewer.js");
const ed = require("../lib/edition.js");

test("fitState fits and centres the image in the frame", () => {
  // 2000×1000 image in a 500×500 frame: width-limited, scale .25, centred vertically
  assert.deepEqual(v.fitState(2000, 1000, 500, 500), { scale: 0.25, x: 0, y: 125 });
  assert.deepEqual(v.fitState(0, 0, 500, 500), { scale: 1, x: 0, y: 0 });
});

test("zoomAt keeps the image point under the pointer fixed", () => {
  const s0 = { scale: 0.5, x: 10, y: 20 };
  const p = { x: 110, y: 70 };
  const imgPt = (s) => [(p.x - s.x) / s.scale, (p.y - s.y) / s.scale];
  const s1 = v.zoomAt(s0, 2, p.x, p.y, 0.5);
  assert.equal(s1.scale, 1);
  assert.deepEqual(imgPt(s1), imgPt(s0));
});

test("zoomAt clamps between the fit scale and MAX_SCALE", () => {
  assert.equal(v.zoomAt({ scale: 0.5, x: 0, y: 0 }, 0.1, 0, 0, 0.5).scale, 0.5);
  assert.equal(v.zoomAt({ scale: 4, x: 0, y: 0 }, 100, 0, 0, 0.5).scale, v.MAX_SCALE);
});

test("imageUrl joins the image service base URL and the catalog path", () => {
  assert.equal(ed.imageUrl({ path: "Seikilos2.png" }), "https://shot.holycross.edu/images/mousike/Seikilos2.png");
  assert.equal(ed.imageUrl({ path: "/sub/x.jpg" }), "https://shot.holycross.edu/images/mousike/sub/x.jpg");
  assert.equal(ed.imageUrl(null), null);
  assert.equal(ed.imageUrl({ path: "" }), null);
});

test("regionBox maps fractional ROIs through the view transform", () => {
  const st = { scale: 0.5, x: 10, y: 20 };
  // 1000×2000 image; ROI at 10%,25% size 20%×5%
  assert.deepEqual(v.regionBox(st, 1000, 2000, { left: 0.1, top: 0.25, width: 0.2, height: 0.05 }),
    { left: 10 + 50, top: 20 + 250, width: 100, height: 50 });
  // after zoomAt, a region keeps its place relative to the image point under the pointer
  const s2 = v.zoomAt(st, 2, 60, 270, 0.5);
  const b = v.regionBox(s2, 1000, 2000, { left: 0.1, top: 0.25, width: 0.2, height: 0.05 });
  assert.deepEqual([b.left, b.top, b.width, b.height], [60, 270, 200, 100]);
});

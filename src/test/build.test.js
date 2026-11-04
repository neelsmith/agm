const test = require("node:test");
const assert = require("node:assert/strict");
const { render, version } = require("../build.js");
const pkg = require("../package.json");

test("the built app shows the package.json version", () => {
  assert.equal(version, pkg.version);
  assert.match(version, /^\d+\.\d+\.\d+/);
  for (const [app, loadControls] of ["artifacts", "mss", "texts"].flatMap((a) => [[a, false], [a, true]])) {
    const html = render({ app, loadControls });
    assert.ok(html.includes(`<span id="app-version">${version}</span>`));
    assert.ok(!html.includes("@@"), "no unreplaced build markers");
  }
});

test("only the fixture builds have the data-source controls", () => {
  for (const app of ["artifacts", "mss", "texts"]) {
    assert.ok(!render({ app }).includes('id="file"'));
    assert.ok(render({ app, loadControls: true }).includes('id="file"'));
  }
});

test("apps are written as agm-<app>.html and agm-<app>-fixture.html", () => {
  const { APPS, fileName } = require("../build.js");
  assert.deepEqual(Object.keys(APPS), ["artifacts", "mss", "texts"]);
  assert.equal(fileName("artifacts"), "agm-artifacts.html");
  assert.equal(fileName("mss", true), "agm-mss-fixture.html");
  assert.equal(fileName("texts", true), "agm-texts-fixture.html");
});

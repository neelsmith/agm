const test = require("node:test");
const assert = require("node:assert/strict");
const { render, version } = require("../build.js");
const pkg = require("../package.json");

test("the built app shows the package.json version", () => {
  assert.equal(version, pkg.version);
  assert.match(version, /^\d+\.\d+\.\d+/);
  for (const loadControls of [false, true]) {
    const html = render({ loadControls });
    assert.ok(html.includes(`<span id="app-version">${version}</span>`));
    assert.ok(!html.includes("@@"), "no unreplaced build markers");
  }
});

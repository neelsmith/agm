// Build the fixture apps: node src/preview.js  ->  src/dist/agm-<app>-fixture.html
//
// Each fixture is its app plus the data-source controls (URL box, Load, local file), so a local
// release file (e.g. a draft in the mousike clone) can be loaded.
//
// agm-artifacts-fixture.html also bundles a release fixture and selects the first surface, so its
// UI can be checked without network access. The others bundle no data (agm-mss needs IIIF
// manifests and urnmaps from the network in any case) and load the live release on open.
const fs = require("node:fs");
const path = require("node:path");
const { render, APPS, fileName } = require("./build.js");

const here = __dirname;
const out = (app, html) => {
  fs.mkdirSync(path.join(here, "dist"), { recursive: true });
  fs.writeFileSync(path.join(here, "dist", fileName(app, true)), html);
  console.log(`wrote src/dist/${fileName(app, true)}`);
};

const FIXTURE = "current-2026g.cex";
const fixture = fs.readFileSync(path.join(here, "test", "fixtures", FIXTURE), "utf8");
let html = render({ app: "artifacts", loadControls: true });
html = html.replace("<script>", () => "<script>window.AGM_NO_AUTOLOAD = true;</script>\n<script>");
html = html.replace("</body>", () =>
  `<script>
agm.accept(AgmCex.parseCex(${JSON.stringify(fixture)}), "bundled fixture ${FIXTURE}");
const first = AgmEdition.surfaceMenu(agm.data)[0];
if (first) agm.selectSurface(first.urn);
</script>
</body>`);
out("artifacts", html);

for (const app of Object.keys(APPS)) {
  if (app !== "artifacts") out(app, render({ app, loadControls: true }));
}

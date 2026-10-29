// Build an offline preview: node src/preview.js  ->  src/dist/agm-fixture.html
// Same app as dist/agm.html, but with a release fixture inlined and the first surface
// selected, so the UI can be checked without network access.
const fs = require("node:fs");
const path = require("node:path");
require("./build.js");

const here = __dirname;
const FIXTURE = "current-2026c.cex";
const fixture = fs.readFileSync(path.join(here, "test", "fixtures", FIXTURE), "utf8");
let html = fs.readFileSync(path.join(here, "dist", "agm.html"), "utf8");
html = html.replace("<script>", () => "<script>window.AGM_NO_AUTOLOAD = true;</script>\n<script>");
html = html.replace("</body>", () =>
  `<script>
agm.accept(AgmCex.parseCex(${JSON.stringify(fixture)}), "bundled fixture ${FIXTURE}");
const first = AgmEdition.surfaceMenu(agm.data)[0];
if (first) agm.selectSurface(first.urn);
</script>
</body>`);
fs.writeFileSync(path.join(here, "dist", "agm-fixture.html"), html);
console.log("wrote src/dist/agm-fixture.html");

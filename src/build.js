// Build the self-contained single-file apps: node src/build.js  ->  src/dist/agm-<app>.html
// (agm-artifacts.html, agm-mss.html, agm-texts.html)
const fs = require("node:fs");
const path = require("node:path");

const here = __dirname;
const read = (p) => fs.readFileSync(path.join(here, p), "utf8");

// App version, shown discreetly in the page footer. Maintained only in package.json.
const version = JSON.parse(read("package.json")).version;
if (!/^\d+\.\d+\.\d+/.test(version || "")) throw new Error(`package.json has no valid version: ${version}`);

// Mousike Notation font (SIL OFL 1.1, from the mousike project; see assets/fonts/OFL.txt),
// embedded as a data URI so the page needs no other files.
const font = fs.readFileSync(path.join(here, "assets", "fonts", "MousikeNotation.woff2")).toString("base64");
const fontCss = `/* Mousike Notation font: SIL Open Font License 1.1, derived from Noto Serif and Noto Music. */
@font-face {
  font-family: 'Mousike Notation';
  src: url('data:font/woff2;base64,${font}') format('woff2');
  font-display: block;
}
.mousike-notation { font-family: 'Mousike Notation', serif; }`;

// Shared pieces, inlined into whichever app template uses them.
const parts = {
  FONT_CSS: fontCss,
  BASE_CSS: read("lib/base.css"),
  VIEWER_CSS: read("lib/viewer.css"),
  CEX_JS: read("lib/cex.js"),
  EDITION_JS: read("lib/edition.js"),
  SOWERBY_TABLE_JS: read("lib/sowerby-table.js"),
  NOTATION_JS: read("lib/notation.js"),
  VIEWER_JS: read("lib/viewer.js"),
  ARTIFACTS_APP_JS: read("lib/artifacts-app.js"),
  MSS_JS: read("lib/mss.js"),
  MSS_APP_JS: read("lib/mss-app.js"),
  TEXTS_JS: read("lib/texts.js"),
  TEXTS_APP_JS: read("lib/texts-app.js"),
};

// The apps: template plus the parts it needs (every one must appear in the template, once).
const APPS = {
  artifacts: {
    template: "artifacts-app.html",
    parts: ["FONT_CSS", "BASE_CSS", "VIEWER_CSS", "CEX_JS", "EDITION_JS", "SOWERBY_TABLE_JS",
      "NOTATION_JS", "VIEWER_JS", "ARTIFACTS_APP_JS"],
  },
  mss: {
    template: "mss-app.html",
    parts: ["FONT_CSS", "BASE_CSS", "VIEWER_CSS", "CEX_JS", "VIEWER_JS", "SOWERBY_TABLE_JS",
      "NOTATION_JS", "MSS_JS", "MSS_APP_JS"],
  },
  texts: {
    template: "texts-app.html",
    parts: ["FONT_CSS", "BASE_CSS", "VIEWER_CSS", "CEX_JS", "SOWERBY_TABLE_JS", "NOTATION_JS", "VIEWER_JS",
      "EDITION_JS", "MSS_JS", "TEXTS_JS", "TEXTS_APP_JS"],
  },
};

/** Output file name of an app: "agm-<app>.html", or "agm-<app>-fixture.html" with load controls. */
const fileName = (app, fixture = false) => `agm-${app}${fixture ? "-fixture" : ""}.html`;

// Data-source controls (URL box, Load button, local file). Only the fixture builds have
// them; the plain dist/agm-<app>.html files always load the default mousike release.
const LOAD_CONTROLS = `  <div class="controls">
    <input id="url" type="url" aria-label="CEX URL">
    <button id="load">Load</button>
    <label>or local file <input id="file" type="file" accept=".cex,.txt"></label>
  </div>`;

/**
 * Render one single-file app.
 * @param {{app?: "artifacts"|"mss"|"texts", loadControls?: boolean}} opts  loadControls: include
 *   the URL box, Load button and local-file input (off for dist/agm-<app>.html, on for
 *   dist/agm-<app>-fixture.html).
 */
function render({ app = "artifacts", loadControls = false } = {}) {
  const spec = APPS[app];
  if (!spec) throw new Error(`unknown app ${app}`);
  let html = read(spec.template);
  const htmlParts = { LOAD_CONTROLS: loadControls ? LOAD_CONTROLS : "", VERSION: version };
  const all = { ...Object.fromEntries(spec.parts.map((n) => [n, parts[n]])), ...htmlParts };
  for (const [name, content] of Object.entries(all)) {
    const marker = name in htmlParts ? `<!--@@${name}@@-->` : `/*@@${name}@@*/`;
    if (!html.includes(marker)) throw new Error(`${spec.template} is missing ${marker}`);
    // Function replacer so `$` sequences in source aren't treated as patterns.
    html = html.replace(marker, () => content);
  }
  return html;
}

module.exports = { render, version, APPS, fileName };

if (require.main === module) {
  fs.mkdirSync(path.join(here, "dist"), { recursive: true });
  for (const app of Object.keys(APPS)) {
    fs.writeFileSync(path.join(here, "dist", fileName(app)), render({ app }));
    console.log(`wrote src/dist/${fileName(app)}`);
  }
}

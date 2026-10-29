// Build the single self-contained app file: node src/build.js  ->  src/dist/agm.html
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

const parts = {
  FONT_CSS: fontCss,
  CEX_JS: read("lib/cex.js"),
  EDITION_JS: read("lib/edition.js"),
  SOWERBY_TABLE_JS: read("lib/sowerby-table.js"),
  NOTATION_JS: read("lib/notation.js"),
  VIEWER_JS: read("lib/viewer.js"),
  APP_JS: read("lib/app.js"),
};

// Data-source controls (URL box, Load button, local file). Only the fixture preview has
// them; dist/agm.html always loads the default mousike release.
const LOAD_CONTROLS = `  <div class="controls">
    <input id="url" type="url" aria-label="CEX URL">
    <button id="load">Load</button>
    <label>or local file <input id="file" type="file" accept=".cex,.txt"></label>
  </div>`;

/**
 * Render the single-file app.
 * @param {{loadControls?: boolean}} opts  loadControls: include the URL box, Load button
 *   and local-file input (off for dist/agm.html, on for the fixture preview).
 */
function render({ loadControls = false } = {}) {
  let html = read("app.html");
  const htmlParts = { LOAD_CONTROLS: loadControls ? LOAD_CONTROLS : "", VERSION: version };
  const all = { ...parts, ...htmlParts };
  for (const [name, content] of Object.entries(all)) {
    const marker = name in htmlParts ? `<!--@@${name}@@-->` : `/*@@${name}@@*/`;
    if (!html.includes(marker)) throw new Error(`app.html is missing ${marker}`);
    // Function replacer so `$` sequences in source aren't treated as patterns.
    html = html.replace(marker, () => content);
  }
  return html;
}

module.exports = { render, version };

if (require.main === module) {
  fs.mkdirSync(path.join(here, "dist"), { recursive: true });
  fs.writeFileSync(path.join(here, "dist", "agm.html"), render());
  console.log("wrote src/dist/agm.html");
}

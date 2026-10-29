// Build the single self-contained app file: node src/build.js  ->  src/dist/agm.html
const fs = require("node:fs");
const path = require("node:path");

const here = __dirname;
const read = (p) => fs.readFileSync(path.join(here, p), "utf8");

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
  APP_JS: read("lib/app.js"),
};

let html = read("app.html");
for (const [name, content] of Object.entries(parts)) {
  const marker = `/*@@${name}@@*/`;
  if (!html.includes(marker)) throw new Error(`app.html is missing ${marker}`);
  // Function replacer so `$` sequences in source aren't treated as patterns.
  html = html.replace(marker, () => content);
}

fs.mkdirSync(path.join(here, "dist"), { recursive: true });
fs.writeFileSync(path.join(here, "dist", "agm.html"), html);
console.log("wrote src/dist/agm.html");

// Build the single self-contained app file: node src/build.js  ->  src/dist/agm.html
const fs = require("node:fs");
const path = require("node:path");

const here = __dirname;
const read = (p) => fs.readFileSync(path.join(here, p), "utf8");

let html = read("app.html");
// Use function replacers so `$` sequences in source aren't treated as patterns.
html = html.replace("/*@@CEX_JS@@*/", () => read("lib/cex.js"));
html = html.replace("/*@@APP_JS@@*/", () => read("lib/app.js"));

fs.mkdirSync(path.join(here, "dist"), { recursive: true });
fs.writeFileSync(path.join(here, "dist", "agm.html"), html);
console.log("wrote src/dist/agm.html");

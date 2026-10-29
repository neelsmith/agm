/* app.js — UI for loading and inspecting a mousike CEX release. Depends on global AgmCex. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const urlInput = $("url");
  const statusEl = $("status");
  const out = $("out");

  /** Parsed release data, exposed for console inspection and later app stages. */
  window.agm = { data: null };

  urlInput.value = AgmCex.DEFAULT_URL;

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? "error" : "";
  }

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, attrs || {});
    for (const k of kids) e.append(k);
    return e;
  }

  const GREEK_COLS = { texts: ["text"], syllables: ["text"] };

  function tableFor(name, rows) {
    const cols = AgmCex.BLOCK_SCHEMAS[name];
    const t = el("table");
    t.append(el("thead", null, el("tr", null, ...cols.map((c) => el("th", { textContent: c })))));
    const tb = el("tbody");
    for (const r of rows) {
      tb.append(el("tr", null, ...cols.map((c) => {
        const v = r[c];
        let cls = "";
        if (/^urn:/.test(v)) cls = "urn";
        else if ((GREEK_COLS[name] || []).includes(c)) cls = "greek";
        return el("td", { textContent: v, className: cls });
      })));
    }
    t.append(tb);
    return el("div", { className: "scroll" }, t);
  }

  function render(d) {
    out.replaceChildren();
    const summary = el("div", { className: "summary" });
    summary.append(el("div", null, el("b", { textContent: d.version ?? "—" }), el("span", { textContent: "version" })));
    for (const name of AgmCex.BLOCK_NAMES.slice(1)) {
      summary.append(el("div", null, el("b", { textContent: String(d[name].length) }), el("span", { textContent: name })));
    }
    out.append(summary);

    if (d.warnings.length) {
      out.append(el("div", { className: "warnings" },
        el("p", { textContent: `${d.warnings.length} warning(s):` }),
        el("ul", null, ...d.warnings.map((w) => el("li", { textContent: w })))));
    }
    for (const name of AgmCex.BLOCK_NAMES.slice(1)) {
      out.append(el("details", null,
        el("summary", { textContent: `#!${name} (${d[name].length})` }),
        tableFor(name, d[name])));
    }
  }

  function accept(d, source) {
    window.agm.data = d;
    setStatus(`Loaded release ${d.version} from ${source}.`);
    render(d);
  }

  async function loadUrl() {
    const url = urlInput.value.trim() || AgmCex.DEFAULT_URL;
    setStatus("Loading…");
    try {
      accept(await AgmCex.loadCex(url), url);
    } catch (e) {
      setStatus(`Could not load ${url}: ${e.message}. Try loading a local copy instead.`, true);
    }
  }

  $("load").addEventListener("click", loadUrl);
  urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loadUrl(); });
  $("file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { accept(AgmCex.parseCex(await f.text()), f.name); }
    catch (err) { setStatus(`Could not parse ${f.name}: ${err.message}`, true); }
  });

  loadUrl();
})();

"""Dump mousike's Python Unicode rendering as a JSON reference for agm's JS tests.

Reads (never writes) a mousike checkout:

    PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=<mousike>/src \
        python3 -B src/tools/make-python-reference.py <mousike> > src/test/fixtures/python-unicode.json
"""
import json
import pathlib
import sys

from mousike import note_to_unicode, notes_to_unicode
from mousike.note import load_table

mousike = pathlib.Path(sys.argv[1])

notes = {}
errors = []
for key in load_table():
    if not key:
        continue
    if key.count(".") == 0:          # single-tier sign, e.g. the rest gcn:1
        notes[key] = note_to_unicode(key)
        continue
    notes[key] = note_to_unicode(key)  # short form
    for length in range(1, 6):
        for arsis in (0, 1):
            for hyphen in (0, 1):
                u = f"{key}.{length}.{arsis}.{hyphen}"
                notes[u] = note_to_unicode(u)
    notes["urn:cite2:zst:" + key + ".2.1.0"] = note_to_unicode("urn:cite2:zst:" + key + ".2.1.0")

for bad in ["gvn:99.1.1.0.0", "gvn:11.1.6.0.0", "gvn:11.1.1.2.0", "gvn", "gvn:11.x",
            "gvn:11.1.1.0.0.0", "gcn:1.1", "xyz:1.1"]:
    try:
        note_to_unicode(bad)
    except ValueError:
        errors.append(bad)
    else:
        raise SystemExit(f"expected ValueError for {bad}")

lines = {}
for line in (mousike / "editions" / "seikilos_notation.cex").read_text(encoding="utf-8").splitlines()[1:]:
    if line.strip():
        urn, text = line.split("|", 1)
        lines[text] = notes_to_unicode(text)

json.dump({"notes": notes, "errors": errors, "lines": lines}, sys.stdout, ensure_ascii=False, indent=1)

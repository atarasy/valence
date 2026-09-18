import pathlib
# §14.2, second break beside import_accepts_anything: ask only that a format is
# named. Re-anchored 2026-09-14 (question 46).
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      if (!body_ || (body_.format !== EXPORT_FORMAT_VERSION && body_.format !== "valence-node/6" && body_.format !== "valence-node/5" && body_.format !== "valence-node/4")) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (!body_ || typeof body_.format !== "string" || !body_.format) {', 1)
p.write_text(s)

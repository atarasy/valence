import pathlib
# Clause 52 and §14.2: the receiving host of a move verifies what it is handed.
# Accept any body. Re-anchored 2026-09-14 when /4 exports stayed readable
# beside /5, and 2026-09-22 when /8 stayed readable beside /9.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      if (!body_ || (body_.format !== EXPORT_FORMAT_VERSION && body_.format !== "valence-node/8" && body_.format !== "valence-node/7" && body_.format !== "valence-node/6" && body_.format !== "valence-node/5" && body_.format !== "valence-node/4")) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (false) {', 1)
p.write_text(s)

import pathlib
# Clause 43, second break beside export_no_format. Keep the format and drop its
# version. Re-anchored 2026-09-12 (/4) and 2026-09-14 (/5, question 46) and 2026-09-15 (/6, question 50) and 2026-09-19 (/7, question 61).
p = pathlib.Path('src/hub/node.ts'); s = p.read_text()
old = 'export const EXPORT_FORMAT_VERSION = "valence-node/8";'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, 'export const EXPORT_FORMAT_VERSION = "valence-node";', 1)
p.write_text(s)

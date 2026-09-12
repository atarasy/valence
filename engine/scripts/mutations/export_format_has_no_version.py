import pathlib
# Clause 43, second break beside export_no_format. Keep the format and drop
# its version, so a receiving host knows the shape's name and not which shape.
# A format that cannot say which version it is cannot be refused by one.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
# Re-anchored 2026-09-12 when the collections joined the export and the
# version went to /4.
old = 'export const EXPORT_FORMAT_VERSION = "valence-node/4";'
assert old in s, "export_format_has_no_version: the anchor has drifted"
s = s.replace(old, 'export const EXPORT_FORMAT_VERSION = "valence-node";', 1)
p.write_text(s)

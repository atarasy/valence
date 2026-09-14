import pathlib
# Clause 52, §14, question 46. The node export empties each collection's notes,
# so a moved household arrives with its losses and without their reasons.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
old = "      .filter((r): r is Recovery => r !== undefined),"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "      .filter((r): r is Recovery => r !== undefined).map((r) => ({ ...r, missing_notes: {} })),", 1)
p.write_text(s)

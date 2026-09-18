import pathlib
# §14.2 and §6.4, question 57. Let an expired offer that still owes a
# settlement travel. It holds a reserve at the host it left and can never
# settle where it arrives; on an adapter that commits without a reserve it is
# charged at both.
p = pathlib.Path('src/shared/statement.ts'); s = p.read_text()
old = '  return offer.candidates.some((c) => c.valence === "kept" || c.valence === "defaulted" || c.valence === "consumed" || c.valence === "lost");\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '  return false;\n', 1))

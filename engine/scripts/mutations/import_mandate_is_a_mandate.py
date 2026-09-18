import pathlib
# §14.2, question 56. Write a mandate that arrives by a move as a mandate
# rather than as a claim, so a row nobody signed is one this host holds: the
# hub answers for it, an offer may name it, and the ceiling it carries applies.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    this.claims.set(m.id, { ...m, co_signers: [...m.co_signers] });\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    this.rows.set(m.id, { ...m, co_signers: [...m.co_signers] });\n', 1))

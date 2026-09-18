import pathlib
# §16.2 and §14.2, question 56. Count a claim among the mandates a household
# holds, so that a move fails closed. **That is the defect, not the rule**: the
# import route authenticates nobody, so one unsigned POST then froze any
# household on the host, including one that held no mandate and had never
# moved, and nothing removed a claim. Measured 2026-09-18.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    return [...this.rows.values()].filter((m) => m.household === household);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    return [...this.rows.values(), ...this.claims.values()].filter((m) => m.household === household);\n', 1))

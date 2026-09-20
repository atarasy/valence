import pathlib
# §14.2, §16.5, decided 2026-09-20 after the third refutation pass over
# question 68. The record of what each decided set was decided under left out
# of the export, so a household that exercises clause 43 arrives with the
# protections of every decided set gone. This is question 50's `confirmations`
# in a second place.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
old = "    decided_protections: engine.decidedProtectionsFor(offers.map((o) => o.id)),"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    decided_protections: {},", 1)
p.write_text(s)

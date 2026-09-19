import pathlib
# §14.2, question 66. Write nothing about where a store stands, so a store
# that predates the record says nothing and one opened after it is never
# recorded as having the record from the start.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      provenance.set("settled_here", settledBefore > 0 ? "unrecorded: this store predates the record" : "recorded from the first settlement");\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)

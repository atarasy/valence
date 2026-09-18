import pathlib
# §6.4, §14.2, question 62. The export carries a set that owes nothing
# without settling it first, so it stays behind its reserve on a move.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      await engine.settleWhatOwesNothing(household);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)

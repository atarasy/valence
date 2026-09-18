import pathlib
# §12, §14, question 61. The giver's export carries no payments, so a giver
# that moves takes no record of what it paid.
p = pathlib.Path('src/hub/node.ts'); s = p.read_text()
old = '    payments: engine.paymentsBy(household),\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    payments: [],\n', 1)
p.write_text(s)

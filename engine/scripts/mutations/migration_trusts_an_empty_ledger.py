import pathlib
# Question 66. Run the marker pass wherever the ledger says it keeps its rows,
# even when it keeps none for this store's settlements, which marks every
# settlement a host made before the reference ledger was persisted.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      const remembers = settled.length === 0 || (ledger.durable === true && settled.some((id) => ledger.get(id) !== undefined));\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      const remembers = ledger.durable === true || settled.length === 0 || settled.some((id) => ledger.get(id) !== undefined);\n', 1)
p.write_text(s)

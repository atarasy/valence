import pathlib
# §14.2, question 52. Replace the household's receipts on import, so a second import erases receipts the host recorded.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (added.length) this.receipts.set(household, [...held, ...structuredClone(added)]);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    this.receipts.set(household, structuredClone(rows));', 1)
p.write_text(s)

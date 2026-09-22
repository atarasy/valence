import pathlib
# §6.6, question 70. Let a merchant the household paid nothing append one.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (charged === 0) throw unprocessable("not_merchant_of_record", `${c.merchant} was charged for nothing on offer ${c.offer}`);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)

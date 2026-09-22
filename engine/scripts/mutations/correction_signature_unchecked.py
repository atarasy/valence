import pathlib
# §6.6, question 70. Take a correction nobody signed as the merchant's.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (!verifyCorrection(c, pem)) throw unprocessable("bad_signature", `this correction is not signed by ${c.merchant}`);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)

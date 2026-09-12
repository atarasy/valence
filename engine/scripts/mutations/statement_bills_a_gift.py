import pathlib
# §6.2, §6.5, clause 10. The statement proposes a gift at its price, so the
# household is asked to sign for goods that arrive at their price and are
# never billed. The settlement still charges zero, so the two disagree and the
# signature covers a document the receipt contradicts.
p = pathlib.Path("src/shared/statement.ts"); s = p.read_text()
a = "      amount: c.given_by ? 0 : c.unit_price * c.quantity,"
assert a in s, "shared/statement.ts gift anchor has drifted"
s = s.replace(a, "      amount: c.unit_price * c.quantity,", 1)
p.write_text(s)

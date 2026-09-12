import pathlib

# §6.5, §7.5b, 法11条1号, question 40. The carriage leaves the bytes a household
# signs, so the one item the statute puts on that screen beside the price is
# outside what was agreed: the household reads a figure, signs, and has no
# record anywhere that it did. **This is what the form did until 2026-09-13**,
# and the register had been taught the day before to refuse a second record
# naming a different figure, which stopped the number moving and left the gap
# it moved in.
#
# The break is the field leaving the joined array rather than a zero being
# passed, so it is a behaviour and not a no-op.

p = pathlib.Path("src/shared/statement.ts"); s = p.read_text()
a = '  return Buffer.from([STATEMENT_DOMAIN, offerId, String(carriage), ...body].join("\\n"), "utf8");'
assert a in s, "statement.ts carriage anchor has drifted"
s = s.replace(a, '  return Buffer.from([STATEMENT_DOMAIN, offerId, ...body].join("\\n"), "utf8");', 1)
p.write_text(s)

import pathlib
# §6.5. A disputed line is left out of the settlement's own account of itself:
# `disputed_amount` reads zero and the line says `disputed: false`. The money
# is right and the record says the household confirmed what it refused.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "          line(c, amount, true);"
assert a in s, "offers.ts disputed line anchor has drifted"
s = s.replace(a, "          line(c, amount, false);", 1)
p.write_text(s)

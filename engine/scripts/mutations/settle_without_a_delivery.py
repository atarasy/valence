import pathlib

# §6.5, 法11条1号. A physical box with goods used settles with no delivery
# recorded, so the statement the household signed showed `carriage: null`. The
# statute asks for the carriage beside the price where the price does not
# include it, and `null` is not an answer to that: a merchant whose price
# includes carriage records `0`, while `null` is an implementation that never
# recorded what it did.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
# Re-anchored 2026-09-13: question 40 made `settle` hold the delivery rather
# than only test it, so the carriage could reach the signed bytes.
a = "      if (carried === undefined) {"
assert a in s, "offers.ts delivery_missing anchor has drifted"
s = s.replace(a, "      if (false) {", 1)
p.write_text(s)

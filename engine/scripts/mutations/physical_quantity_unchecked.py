import pathlib

# §11.1, question 49. A physical line may carry more than one, so a line of two with one used is consumed and charged for both.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = '      if (input.binding === "physical" && c.quantity !== 1) {'
assert a in s, "src/engine/offers.ts physical_quantity_unchecked anchor has drifted"
s = s.replace(a, '      if (false) {', 1)
p.write_text(s)

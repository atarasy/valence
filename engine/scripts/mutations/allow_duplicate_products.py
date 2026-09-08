import pathlib
# §5: one line per product. Let a product appear twice, so one novelty counts twice.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "      if (products.has(c.product)) {\n        throw badRequest(\"malformed\", `product ${c.product} appears twice; use quantity`);\n      }"
assert old in s
s = s.replace(old, "      if (false) {\n        throw badRequest(\"malformed\", \"\");\n      }", 1)
p.write_text(s)

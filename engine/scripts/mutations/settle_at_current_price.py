import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("        kept += c.unit_price * c.quantity;",
              "        kept += (config.products[c.product]?.price ?? c.unit_price) * c.quantity;", 1)
p.write_text(s)

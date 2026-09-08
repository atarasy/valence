import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("        consumed += entry.cost * c.quantity;", "        consumed += c.unit_price * c.quantity;", 1)
p.write_text(s)

import pathlib
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
s = s.replace("      merchant: input.merchant,\n", "      merchant: \"\",\n", 1)
p.write_text(s)

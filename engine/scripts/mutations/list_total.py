import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace(
  "      return json({\n        offers: engine.offersForHousehold(household).map(offerView),\n      });",
  "      const rows = engine.offersForHousehold(household).map(offerView);\n"
  "      return json({ offers: rows, total: rows.length });", 1)
p.write_text(s)

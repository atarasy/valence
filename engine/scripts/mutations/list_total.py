import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "      return json({\n        offers: engine.offersForHousehold(household, presenter).map(offerView),\n      });"
assert old in s
s = s.replace(old,
  "      const rows = engine.offersForHousehold(household, presenter).map(offerView);\n"
  "      return json({ offers: rows, total: rows.length });", 1)
p.write_text(s)

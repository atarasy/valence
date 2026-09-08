import pathlib
# Clause 8: the list is one presenter's view, never the household's union.
# Make the presenter optional, so a list asked for without one is served.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      if (!household || !presenter) {\n        throw badRequest("malformed", "household and presenter are required");'
assert old in s
s = s.replace(old, '      if (!household) {\n        throw badRequest("malformed", "household is required");', 1)
old2 = "        offers: engine.offersForHousehold(household, presenter).map(offerView),"
assert old2 in s
s = s.replace(old2, '        offers: engine.offersForHousehold(household, presenter ?? "").map(offerView),', 1)
p.write_text(s)

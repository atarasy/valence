import pathlib
# Clause 8, second break beside presenter_optional. The presenter is still
# required and then ignored, so the list a presenter reads is every offer the
# household holds. The other mutation makes the parameter optional; this one
# keeps it and answers a different question.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '        offers: engine.offersForHousehold(household, presenter).map(offerView),'
assert old in s, "the_list_is_the_households_union: the anchor has drifted"
s = s.replace(old, '        offers: engine.unionForHousehold(household).map(offerView),', 1)
p.write_text(s)

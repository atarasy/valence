import pathlib
# Section 6.1, second break beside balance_route. No route returns a balance
# and the household's own list carries one, which is where a stored value
# arrives when the route for it was refused and the idea was kept.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      return json({\n        offers: engine.offersForHousehold(household, presenter).map(offerView),\n      });'
assert old in s, "balance_on_the_household_list: the anchor has drifted"
s = s.replace(old, '      return json({\n        balance: 0,\n        offers: engine.offersForHousehold(household, presenter).map(offerView),\n      });', 1)
p.write_text(s)

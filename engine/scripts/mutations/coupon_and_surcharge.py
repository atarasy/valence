import pathlib
# §3.1, clause 10: a request cannot raise what a household pays. Accept a
# surcharge on the candidate and add it to the merchant's price.
h = pathlib.Path("src/http.ts"); s = h.read_text()
old = '          ["product", "quantity", "predicted_conversion", "is_exploration", "given_by"],'
assert old in s
s = s.replace(old, '          ["product", "quantity", "predicted_conversion", "is_exploration", "given_by", "coupon", "surcharge"],', 1)
old2 = "          given_by: optionalGiver(entry, `candidate ${i}`),"
assert old2 in s
s = s.replace(old2, old2 + "\n          surcharge: typeof entry.surcharge === \"number\" ? entry.surcharge : 0,", 1)
h.write_text(s)
e = pathlib.Path("src/engine/offers.ts"); t = e.read_text()
old3 = "      is_exploration: boolean;\n      given_by: string | null;\n    }[];"
assert old3 in t
t = t.replace(old3, "      is_exploration: boolean;\n      given_by: string | null;\n      surcharge?: number;\n    }[];", 1)
old4 = "        unit_price: entry.price,"
assert old4 in t
t = t.replace(old4, "        unit_price: entry.price + (c.surcharge ?? 0),", 1)
e.write_text(t)

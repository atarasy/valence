import pathlib

# Clause 10: no field, parameter or configuration lets a request set the price.
# This opens the gate in all three places it is closed: the accepted-field list,
# the request type, and the assignment that takes the price from the catalogue.
#
# Every replacement asserts its anchor. Until 2026-09-09 none of them did, and
# two had drifted (the accepted-field list gained `given_by` and the type gained
# a field when the gift model landed). The script still changed bytes, so the
# INERT check passed, while the validation gate stayed shut and the probe went
# on passing. The mutation was recorded in the ledger as caught by one probe and
# was in fact testing nothing.

h = pathlib.Path("src/http.ts"); s = h.read_text()
a1 = '          ["product", "quantity", "predicted_conversion", "is_exploration", "given_by"],'
assert a1 in s, "http.ts accepted-field anchor has drifted"
s = s.replace(a1, '          ["product", "quantity", "predicted_conversion", "is_exploration", "given_by", "unit_price"],', 1)
h.write_text(s)

e = pathlib.Path("src/engine/offers.ts"); t = e.read_text()
a2 = "      is_exploration: boolean;\n      given_by: string | null;\n    }[];"
assert a2 in t, "offers.ts request-type anchor has drifted"
t = t.replace(a2, "      is_exploration: boolean;\n      given_by: string | null;\n      unit_price?: number;\n    }[];", 1)
a3 = "        unit_price: entry.price,"
assert a3 in t, "offers.ts price-assignment anchor has drifted"
t = t.replace(a3, "        unit_price: (c as { unit_price?: number }).unit_price ?? entry.price,", 1)
e.write_text(t)

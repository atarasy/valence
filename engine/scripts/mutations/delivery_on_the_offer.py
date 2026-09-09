import pathlib

# Clause 49 and §7.5b. Put the delivery on the offer view, where a merchant
# reads it. A carrier's code is not an address and resolves to one, so this is
# the merchant learning where the household lives with no field for an address
# anywhere in the response.
#
# The first version of this script added the fields to the stored candidate in
# `engine/offers.ts` and survived: `offerView` in http.ts names every field it
# emits, so nothing reaches a response by being stored. That is the design
# working, and it is also why the mutation has to change the view.

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = """    mandate: o.mandate,
    candidates: o.candidates.map(candidateView),
  };"""
assert a in s, "http.ts offerView anchor has drifted"
s = s.replace(a, """    mandate: o.mandate,
    candidates: o.candidates.map(candidateView),
    code: "dc-probe-2",
    carriage: 550,
  };""", 1)
p.write_text(s)

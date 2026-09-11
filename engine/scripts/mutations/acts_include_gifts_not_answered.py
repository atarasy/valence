import pathlib
# Clause 16 and section 7.2, second break beside inaction_field_on_acts. No
# field is added and the gifts themselves are put on the giver's surface, so
# what is missing from the list is what was not reciprocated. Absence carries
# the signal the clause forbids returning.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '      if (edge.kind === "gift") continue;'
assert old in s, "acts_include_gifts_not_answered: the anchor has drifted"
s = s.replace(old, '      void edge;', 1)
p.write_text(s)

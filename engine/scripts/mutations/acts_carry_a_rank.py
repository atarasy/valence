import pathlib
# Section 7.7, second break beside lineage_acts_total. No total is added and
# each act is ranked instead, which is the same display arriving as an order
# rather than as a sum. The clause names totals and ranking together for this
# reason.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      return json({ acts: engine.actsVisibleToGiver(giver) });'
assert old in s, "acts_carry_a_rank: the anchor has drifted"
s = s.replace(old, '      return json({ acts: engine.actsVisibleToGiver(giver).map((a, i) => ({ ...a, rank: i + 1 })) });', 1)
p.write_text(s)

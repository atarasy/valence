import pathlib
# §5: remove the dedicated refusal for exhausted presenter novelty.
# In the completed mutation logs from the still-running original 299 sweep,
# reviewed 2026-09-13, both tested offers remain below the exploration floor
# and are refused. The HTTP and unit assertions detect exploration_floor in
# place of nothing_new, not acceptance of an offer with no exploration.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    if (novelLeft === 0) {"
assert old in s
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)

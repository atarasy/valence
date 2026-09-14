import pathlib
# §6.5, question 46 R1. A box with only missing lines holds the presenter's next
# box, though nothing is owed on it.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (recovery && recovery.collected_at !== null && recovery.consumed.length > 0) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (recovery && recovery.collected_at !== null && (recovery.consumed.length > 0 || recovery.missing.length > 0)) {', 1)
p.write_text(s)

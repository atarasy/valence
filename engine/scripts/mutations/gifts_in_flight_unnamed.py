import pathlib
# §12, §14.2, question 61. A giver's move names no gift it pays for that is
# still in flight, while the reserve is held at the host it left.
p = pathlib.Path('src/hub/node.ts'); s = p.read_text()
old = '    gifts_in_flight: engine.giftsInFlightBy(household, now),\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    gifts_in_flight: [],\n', 1)
p.write_text(s)

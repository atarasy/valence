import pathlib
# Clause 21 and section 7.7. The row gains the count the mutation beside it
# computed, which is the second half of the same break and is kept separate
# so that each anchor stands alone.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '      rows.push({\n        from: edge.from,\n        to: edge.to,'
assert old in s, "the_circle_row_carries_a_degree: the anchor has drifted"
s = s.replace(old, '      rows.push({\n        degree: 0,\n        from: edge.from,\n        to: edge.to,', 1)
p.write_text(s)

import pathlib
# Clause 21 and section 7.7. Each row gains a constant degree field of zero.
# This exposes a forbidden aggregate-shaped field; it does not compute the
# network degree. The neighbouring mutation tests the computed count separately.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '      rows.push({\n        from: edge.from,\n        to: edge.to,'
assert old in s, "the_circle_row_carries_a_degree: the anchor has drifted"
s = s.replace(old, '      rows.push({\n        degree: 0,\n        from: edge.from,\n        to: edge.to,', 1)
p.write_text(s)

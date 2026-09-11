import pathlib
# Section 8. Take the maker out of the catalogue's signed bytes, so whoever
# relays a catalogue can change who made a product under a signature that
# still verifies, and clause 12 is answered by whatever the relay chose.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = 'return [ref, e.merchant, e.maker, e.ships, String(e.price), e.category ?? ""].join(":");'
assert old in s, "maker_outside_the_signed_catalogue: the anchor has drifted"
s = s.replace(old, 'return [ref, e.merchant, e.ships, String(e.price), e.category ?? ""].join(":");', 1)
p.write_text(s)

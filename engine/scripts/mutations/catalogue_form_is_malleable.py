import pathlib
# Section 8. Join the catalogue's parts without escaping them, which is what
# the form did until 2026-09-12. A merchant named "a:b" with a maker of "c"
# then makes the same bytes as a merchant "a" with a maker "b:c", so whoever
# relays a catalogue can move the boundary between who sold a product and who
# made it, and the presenter's signature still verifies. The mandate's form
# (§16.1) and the edge's (§7.1) had both been escaped for this reason.
#
# It is caught by the engine's own tests rather than by a probe: the
# conformance suites talk HTTP and cannot present a catalogue signed one way
# and read another, which is why `maker_outside_the_signed_catalogue` aborted
# rather than failing anything, and why it was retired.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      return [ref, e.merchant, e.maker, e.ships, String(e.price), e.category ?? ""]
        .map(encodeURIComponent)
        .join(":");"""
assert old in s, "catalogue_form_is_malleable: the anchor has drifted"
s = s.replace(old, """      return [ref, e.merchant, e.maker, e.ships, String(e.price), e.category ?? ""].join(":");""", 1)
p.write_text(s)

import pathlib

# §16.5. Let the collection decide an offer without recording when. The window
# that makes a decision final never starts, so a physical offer can be taken
# back at any time until it settles, by anyone holding the offer id and with no
# signature at all. Measured 2026-09-11: 2.5 seconds after a 1 second window,
# the withdrawal answered 200 and every candidate went back to `offered`.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      offer.decided_at = now;\n    }\n    return this.commit(offer);"
assert a in s, "offers.ts recovery anchor has drifted"
s = s.replace(a, "      void now;\n    }\n    return this.commit(offer);", 1)
p.write_text(s)

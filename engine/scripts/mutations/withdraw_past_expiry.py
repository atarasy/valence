import pathlib

# §16.5, question 47. A signed set on a physical box past its expiry can be
# taken back. **This is what the engine did until 2026-09-15.** The reset put
# the kept line back to `offered`, the deadline made it `lost` once the grace
# had passed, and the box settled at nothing with the goods kept.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """    if (offer.binding === "physical" && now >= offer.expires_at) {"""
assert a in s, "offers.ts withdraw-past-expiry anchor has drifted"
s = s.replace(a, """    if (false) {""", 1)
p.write_text(s)

import pathlib

# §6.5. A household re-sending the signature that already settled its box is
# told the signature "was not what settled it". **This is what the engine did
# between the night the two-tabs hole was closed and the morning after**: the
# refusal was written without asking whether the signature arriving is the one
# the settlement recorded, and the engine holds those bytes. A household whose
# answer was lost is charged and told nothing was recorded.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """        const sent = confirmation.signed;
        const offered = "signature" in sent ? sent.signature : sent.assertion.signature;
        if (existing.confirmation !== null && existing.confirmation === offered) {
          return existing;
        }
"""
assert a in s, "offers.ts already-settled comparison anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)

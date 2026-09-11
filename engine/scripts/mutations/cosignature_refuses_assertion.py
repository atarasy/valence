import pathlib

# §16.4. Take a co-signer's bare signature and nothing else, which is what the
# route did until 2026-09-11. A co-signer is a person the household named
# while they had capacity (clause 47), and a person who joined through a hub
# holds a passkey: such a family could name a category that needs a second
# signature and then have no way at all to give one.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """              !verifyPersonal(
                canonicalDecisions(offerId, decisions),
                typeof coSignature === "string" ? { signature: coSignature } : { assertion: coSignature },
                pem,
                this.config.relyingPartyId
              )"""
assert a in s, "offers.ts co-signature anchor has drifted"
s = s.replace(a, """              typeof coSignature !== "string" ||
              !verifyDecisions(offerId, decisions, coSignature, pem)""", 1)
p.write_text(s)

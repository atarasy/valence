import pathlib
# §12, question 64. Take any signature as the giver's.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (!verifyPersonal(canonicalGift(this.giftTerms(offer.id)), giverSignature, key, this.config.relyingPartyId)) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (false) {', 1)
p.write_text(s)

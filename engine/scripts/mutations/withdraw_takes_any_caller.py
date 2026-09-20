import pathlib
# §16.5, decided 2026-09-20 after the third refutation pass over question 68.
# `DELETE /offers/{id}/decisions` takes any caller again, so whoever holds the
# offer id, the presenter included, voids a decision the household signed. The
# pass turned a recipient's written refusal of a gift into a 1,200 charge to
# its giver that way, five days into a window question 68 had lengthened.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """    if (!verifyPersonal(canonicalWithdrawal(offer.id, offer.decided_at ?? 0), sent, householdKey, this.config.relyingPartyId)) {
      throw unprocessable("bad_signature", "the signature does not cover taking this set back");
    }"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)

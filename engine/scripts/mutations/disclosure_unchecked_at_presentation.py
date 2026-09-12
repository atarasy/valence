import pathlib
# §10a.3. Present an offer whose candidates name a merchant with no disclosure.
# The household then reads a candidate it can never buy, decides on it, signs,
# and the whole set is refused at the decision, because a decided set is
# all-or-nothing. **Refusing at presentation costs the presenter one offer it
# can still fix; refusing later costs the person everything they just signed.**
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """    for (const candidate of offer.candidates) {
      const block = offer.disclosures.find((d) => d.merchant === candidate.merchant);
      if (!block) {
        throw unprocessable(
          "disclosure_missing",
          `${candidate.merchant} has no disclosure on this offer`
        );
      }
    }"""
assert old in s, "disclosure_unchecked_at_presentation: the anchor has drifted"
s = s.replace(old, "", 1)
p.write_text(s)

import pathlib
# §10a.3. Drop the check, so a set naming a merchant with no disclosure
# settles. The person committed without seeing what that seller had to say,
# and nothing in the record afterwards says so.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      const block = offer.disclosures.find((d) => d.merchant === candidate.merchant);
      if (!block) {"""
assert old in s, "decide_without_disclosure: the anchor has drifted"
s = s.replace(old, """      const block = offer.disclosures.find((d) => d.merchant === candidate.merchant);
      if (false && !block) {""", 1)
p.write_text(s)

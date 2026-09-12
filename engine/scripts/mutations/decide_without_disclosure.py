import pathlib
# §10a.3. Drop the check, so a set naming a merchant with no disclosure
# settles. The person committed without seeing what that seller had to say,
# and nothing in the record afterwards says so.
# Re-anchored 2026-09-12 (evening), when the disclosure gained a product key and the settlement line gained `disputed` (questions 35 and 36).
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      const block = offer.disclosures.find(
        (d) => d.merchant === candidate.merchant && d.product === null
      );
      if (!block) {"""
assert old in s, "decide_without_disclosure: the anchor has drifted"
s = s.replace(old, """      const block = offer.disclosures.find(
        (d) => d.merchant === candidate.merchant && d.product === null
      );
      if (false && !block) {""", 1)
p.write_text(s)

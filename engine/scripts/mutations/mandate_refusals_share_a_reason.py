import pathlib

# §16.6. Give every mandate refusal the same name, which is the defect
# novelty_from_this_catalogue was: two different refusals sharing a status
# code and nothing else, so no probe and no person could tell them apart.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
# Re-anchored 2026-09-12: `mandate_co_sign_required` left with §16.4.
for a in ('"mandate_ceiling_daily"', '"mandate_cooling"', '"mandate_lapsed"'):
    assert a in s, f"offers.ts reason {a} has drifted"
    s = s.replace(a, '"unprocessable"')
p.write_text(s)

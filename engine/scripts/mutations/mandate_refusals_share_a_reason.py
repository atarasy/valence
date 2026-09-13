import pathlib

# §16.6. Rename the three refusals below to unprocessable. The out-of-network
# ceiling refusal is unchanged. As novelty_from_this_catalogue showed, a shared
# status alone cannot distinguish the reasons; probes must inspect the name.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
# Re-anchored 2026-09-12: `mandate_co_sign_required` left with §16.4.
for a in ('"mandate_ceiling_daily"', '"mandate_cooling"', '"mandate_lapsed"'):
    assert a in s, f"offers.ts reason {a} has drifted"
    s = s.replace(a, '"unprocessable"')
p.write_text(s)

import pathlib
# §6.5, §10a.5. The statement drops the offer's expiry, which the approval
# carries and which a merchant's stated application period is measured
# against. Added after a refutation pass found the field missing on 2026-09-12.
p = pathlib.Path("src/hub/statement.ts"); s = p.read_text()
a = "    expires_at: offer.expires_at,"
assert a in s, "hub/statement.ts expires_at anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)

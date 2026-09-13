import pathlib
# Drop the merchant of record from the candidate serialisation. The current
# replacement leaves the maker and carrier fields intact (reviewed 2026-09-13).
#
# Re-anchored 2026-09-10. The anchor ran from `ships` straight to
# `predicted_conversion`, and §16.4's `category` was inserted between them the
# same day, so this script went INERT: it changed nothing and reported nothing,
# which is the failure the harness check exists for. That repair used the two
# named lines; the 2026-09-12 anchor below names only the merchant line.
p = pathlib.Path("src/http.ts"); s = p.read_text()
# Re-anchored 2026-09-12: the maker was inserted between these two lines, which
# is the same drift this script's own note describes from 2026-09-09.
old = "    merchant: c.merchant,"
assert old in s, "http.ts candidate view anchor has drifted"
s = s.replace(old, "", 1)
p.write_text(s)

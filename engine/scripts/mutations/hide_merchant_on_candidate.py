import pathlib
# Clause 12: every candidate names who made it and who ships it. Drop both
# from the candidate serialisation.
#
# Re-anchored 2026-09-10. The anchor ran from `ships` straight to
# `predicted_conversion`, and §16.4's `category` was inserted between them the
# same day, so this script went INERT: it changed nothing and reported nothing,
# which is the failure the harness check exists for. The anchor now names only
# the two lines the clause is about.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "    merchant: c.merchant,\n    ships: c.ships,\n"
assert old in s, "http.ts candidate view anchor has drifted"
s = s.replace(old, "", 1)
p.write_text(s)

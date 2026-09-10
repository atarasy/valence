import pathlib

# Clause 52 and §14.2: the receiving host of a move verifies what it is handed.
# Accept any body, whatever format it claims.
#
# The anchor was the literal "valence-node/1" until 2026-09-10, when the import
# was changed to compare against EXPORT_FORMAT_VERSION so that a version bump
# could not pass unnoticed. That change silently broke this script: it still
# replaced nothing, the mutation went INERT, and the ledger row for it was
# unsupported until the next full run said so.

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = "      if (!body_ || body_.format !== EXPORT_FORMAT_VERSION) {"
assert a in s, "http.ts import format-check anchor has drifted"
s = s.replace(a, "      if (false) {", 1)
p.write_text(s)

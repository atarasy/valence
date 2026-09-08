import pathlib
# Clause 12: every candidate names who made it and who ships it. Drop both
# from the candidate serialisation.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "    merchant: c.merchant,\n    ships: c.ships,\n    predicted_conversion: c.predicted_conversion,"
assert old in s
s = s.replace(old, "    predicted_conversion: c.predicted_conversion,", 1)
p.write_text(s)

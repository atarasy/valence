import pathlib

# §16.5. Settle as soon as the set is signed, so a decision the person could
# still take back is already money.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    if (mandate?.cooling_seconds != null && offer.decided_at !== null) {"
assert a in s, "offers.ts cooling anchor has drifted"
s = s.replace(a, "    if (false && mandate?.cooling_seconds != null && offer.decided_at !== null) {", 1)
p.write_text(s)

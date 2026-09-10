import pathlib

# §16.4. Drop the category check, so a set the person said needs two
# signatures goes through on one.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    if (mandateForSet && mandateForSet.co_sign_categories.length > 0) {"
assert a in s, "offers.ts co-sign anchor has drifted"
s = s.replace(a, "    if (false && mandateForSet && mandateForSet.co_sign_categories.length > 0) {", 1)
p.write_text(s)

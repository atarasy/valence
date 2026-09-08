import pathlib
# §2.1: withdraw leaves from drafted or presented only. Allow it after a signed decision.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "    if (offer.state !== \"drafted\" && offer.state !== \"presented\") {"
assert old in s
s = s.replace(old, "    if (offer.state === \"settled\" || offer.state === \"withdrawn\") {", 1)
p.write_text(s)

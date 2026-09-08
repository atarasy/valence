import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = """    if (offer.binding === "physical") {"""
assert old in s, "anchor drifted"
s = s.replace(old, """    if (false) {""", 1)
p.write_text(s)

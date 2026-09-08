import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = """    if (offer.binding === "physical") {
      this.recoveries.open({"""
assert old in s, "anchor drifted"
s = s.replace(old, """    if (false) {
      this.recoveries.open({""", 1)
p.write_text(s)

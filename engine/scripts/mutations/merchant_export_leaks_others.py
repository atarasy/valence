import pathlib
# Clause 8: a merchant holds what was declined to it and nothing declined
# elsewhere. Export every offer in the engine, not this presenter's.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "    return [...this.offers.values()].filter((o) => o.presenter === presenter);"
assert old in s
s = s.replace(old, "    return [...this.offers.values()];", 1)
p.write_text(s)

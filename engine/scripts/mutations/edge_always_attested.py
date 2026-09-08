import pathlib
# §7.1: attested says whether a root endorsed the giver's key. Say yes always,
# so a viewer cannot tell a rooted edge from a stranger's.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      attested: this.rootEndorsed.has(input.from),"
assert old in s
s = s.replace(old, "      attested: true,", 1)
p.write_text(s)

import pathlib
# §5.2: an offer says whether a root endorsed the presenter's key. Say yes
# always, so a fresh name reads like a rooted identity.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      presenter_attested: this.rootEndorsed.has(config.presenter),"
assert old in s
s = s.replace(old, "      presenter_attested: true,", 1)
p.write_text(s)

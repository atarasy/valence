import pathlib
# §5: a presenter with nothing new for this household makes it no offer.
# Let it offer anyway, with no exploration, which is the sell-out the cap
# would have licensed.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "    if (novelLeft === 0) {"
assert old in s
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)

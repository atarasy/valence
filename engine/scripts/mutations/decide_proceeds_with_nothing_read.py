import pathlib
# §16.3, §16.5, decided 2026-09-20. A decision made although this host has
# never read anything for that household, so it is made under no protection
# at all, which is the case the fallback cannot cover.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      if (!this.lastProtectionRead.has(key)) throw err;\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)

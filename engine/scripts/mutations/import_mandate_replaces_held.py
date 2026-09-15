import pathlib
# §14.2, question 52. Let an import replace a mandate this host holds, so co-signers can be dropped without their signatures.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held && stable(held) !== stable(m)) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) {', 1)
p.write_text(s)

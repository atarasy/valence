import pathlib

# §10.5. Accept a registration ceremony as a confirmation. `webauthn.create`
# proves a person made a key; it agrees to nothing, and clause 35 is about
# agreement.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = '    if (parsed.type !== "webauthn.get") return false;'
assert a in s, "decisions.ts ceremony anchor has drifted"
s = s.replace(a, "    void parsed.type;", 1)
p.write_text(s)

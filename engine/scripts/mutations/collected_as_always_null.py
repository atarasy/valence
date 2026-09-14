import pathlib

# §3, question 48. No candidate says what its collection named it, so a hub cannot tell a line not in the box from one the deadline made lost.

p = pathlib.Path("src/shared/collected.ts"); s = p.read_text()
a = '  if (!recovery || recovery.collected_at == null) return null;'
assert a in s, "src/shared/collected.ts collected_as_always_null anchor has drifted"
s = s.replace(a, '  if (recovery || !recovery) return null;', 1)
p.write_text(s)

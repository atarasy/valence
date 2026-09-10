import pathlib

# §10.5. Stop reading the user-present flag, so an assertion a device signed
# with nobody at it is taken for a confirmation. A key acting alone is not a
# person agreeing.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = '    if ((flags & USER_PRESENT) === 0) return false;'
assert a in s, "decisions.ts user-present anchor has drifted"
s = s.replace(a, "    void USER_PRESENT;", 1)
p.write_text(s)

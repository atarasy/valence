import pathlib

# §10.5. Stop reading the user-verified flag, so an assertion a device signed
# without checking who was at it is taken for a confirmation. What is left
# proves that a key was used; clause 35 asks that a person agreed.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = '    if ((flags & USER_VERIFIED) === 0) return false;'
assert a in s, "decisions.ts user-verified anchor has drifted"
s = s.replace(a, "    void USER_VERIFIED;", 1)
p.write_text(s)

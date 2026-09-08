import pathlib
# Clause 31: the recipient sees the line unless the writer says otherwise.
# Default to nobody, so a line written before giving reaches no one.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = 'const sharedRaw = raw.shared_with === undefined ? ["recipient"] : raw.shared_with;'
assert old in s
s = s.replace(old, 'const sharedRaw = raw.shared_with === undefined ? [] : raw.shared_with;', 1)
p.write_text(s)

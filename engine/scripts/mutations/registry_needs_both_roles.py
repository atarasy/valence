import pathlib

# Clause 1, §13.1. Make the registry answerable only where both roles run, so a
# deployment presenting one role cannot resolve a key. Resolution would then be
# a favour a full deployment does rather than neutral infrastructure.

p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
a = 'return owner === "either" ? roles.size > 0 : roles.has(owner);'
assert a in s, "roles.ts answersFor anchor has drifted"
s = s.replace(a, 'return owner === "either" ? roles.size > 1 : roles.has(owner);', 1)
p.write_text(s)

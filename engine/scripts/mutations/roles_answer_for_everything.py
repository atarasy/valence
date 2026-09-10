import pathlib

# §13.1. Answer for every surface whatever roles the deployment declares, which
# is the state before the split: one process with one set of routes, and no way
# for a conformance probe to tell a hub from an engine.

p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
a = "  const owner = ownerOf(parts);\n  return owner === \"either\" ? roles.size > 0 : roles.has(owner);"
assert a in s, "roles.ts answersFor anchor has drifted"
s = s.replace(a, "  return true;", 1)
p.write_text(s)

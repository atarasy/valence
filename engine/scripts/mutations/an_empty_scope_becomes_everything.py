import pathlib
# Clause 37, second break beside empty_scope_ok, in the route. A scope naming
# nothing is filled in with a wildcard, so the ledger sees a scope of one
# field and accepts it. A permission that names no field is not scoped, and
# one that names every field is worse.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '          scope: scope as string[],'
assert old in s, "an_empty_scope_becomes_everything: the anchor has drifted"
s = s.replace(old, '          scope: (scope as string[]).length ? (scope as string[]) : ["*"],', 1)
p.write_text(s)

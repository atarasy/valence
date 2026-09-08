import pathlib
# Clause 20, §7.4: the recipient alone decides whether the query runs. Answer
# it without consulting the permission ledger, which is what the ledger was
# before 2026-09-09: a list no route read.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '    if (!permissions.allows({ household, grantee: asked_by, field: "duplicate_check" })) {'
assert old in s
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)

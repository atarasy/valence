import pathlib

# Clause 43, export in full. Drop the permission ledger from the export, which
# is the state every version before 2026-09-09 shipped in: the ledger was built
# that day and nothing connected it to the export, so a member who moved host
# lost every permission they had granted while the suite stayed green.

p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
a = "    ...permissions.exportFor(household),"
assert a in s, "node.ts export anchor has drifted"
s = s.replace(a, "    permissions: [], queries: [],", 1)
p.write_text(s)

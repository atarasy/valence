import pathlib
# §13.2, question 55. Restate the mandate identifier's form in the read gate
# instead of reading it from the engine, so a name no key has is a mandate.
p = pathlib.Path('../member-read/gate.ts'); s = p.read_text()
old = 'const mandateID = (id: string) => householdOfMandate(id) !== undefined;'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, 'const mandateID = (id: string) => /^key:[A-Za-z0-9_-]{43}\\.[A-Za-z0-9_-]{1,64}$/.test(id);', 1)
p.write_text(s)

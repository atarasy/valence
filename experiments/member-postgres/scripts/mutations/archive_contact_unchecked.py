import pathlib
# Question 72. Admit any value under a disclosure's contact in an archive,
# so a move can carry a contact the merchant never signed in any valid shape.
p = pathlib.Path('../member-transactions/node-import.ts'); s = p.read_text()
old = "...(withContact ? { contact: nullable(disclosureContact) } : {})"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "...(withContact ? { contact: () => {} } : {})", 1)
p.write_text(s)

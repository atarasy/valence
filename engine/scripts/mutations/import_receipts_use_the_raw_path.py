import pathlib
# Clause 43, §14.2. Write the receipts under the path segment as it arrived
# rather than under the household, so a household id that needs encoding
# arrives with its receipts filed under a name nothing reads.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      engine.importReceipts(moving, body_.receipts ?? []);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      engine.importReceipts(parts[1]!, body_.receipts ?? []);', 1)
p.write_text(s)

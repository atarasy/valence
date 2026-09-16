import pathlib
# §16.1, §14.2, question 55. Let a move carry a co-signer named by a free
# string, which a later loosening of that mandate is then checked against.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (!isHouseholdName(k as string)) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '          if (false) {\n', 1))

import pathlib
# §14.2, question 50. Accept a confirmation for an offer the import does not
# carry, so a body holding only `confirmations` unlocks the withdrawal of a set
# this host already holds and reopens the §10.5 replay.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (!carried.has(id)) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false && !carried.has(id)) {\n', 1)
p.write_text(s)

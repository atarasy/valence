import pathlib
# §14.2, question 50. Stop checking the register's shape, so an entry whose
# value is not a list is skipped and its offer arrives with no register.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        shaped !== undefined &&\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        false &&\n', 1)
p.write_text(s)

import pathlib
# §13.2, question 55. Stop checking that a `key:` name is the name of the key
# registered under it, which is what lets a stranger hold a household's name.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (named !== key) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      if (false) {\n', 1))

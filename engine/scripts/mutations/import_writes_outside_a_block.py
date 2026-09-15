import pathlib
# §14.2, question 53. Write an accepted import a statement at a time again, so
# a store that fails partway leaves the move half written and the retry refused.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      atomically(() => {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      ((write: () => void) => write())(() => {\n', 1))

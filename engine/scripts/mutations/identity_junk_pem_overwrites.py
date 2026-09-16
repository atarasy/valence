import pathlib
# Clause 22. Treat two PEMs that do not parse as the same key, so the second
# overwrites the first under a free name and whoever could overwrite it could
# sign as the party that name stands for.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    return one === undefined || two === undefined ? a === b : one === two;'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    return one === two;', 1))

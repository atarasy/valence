import pathlib
# §13.2, question 53. Roll the database back and leave memory as the failed block
# wrote it, so the process serves rows the disk does not hold.
p = pathlib.Path('src/common/store.ts'); s = p.read_text()
old = '    for (const step of undo.reverse()) step();\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))

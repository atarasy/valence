import pathlib
# Question 72. Render a disclosure with no contact as `contact: null` on the
# approval screen, which a client from before the field reads as malformed
# because it checks a block's keys exactly.
p = pathlib.Path('src/hub/approval.ts'); s = p.read_text()
old = '        ...(d.contact ? { contact: d.contact } : {}),\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        contact: d.contact ?? null,\n', 1)
p.write_text(s)

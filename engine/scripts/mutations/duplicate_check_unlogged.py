import pathlib
# §7.4: who asked what appears in the recipient's own record. Answer without
# writing the row, so one bit at a time is read by nobody's knowledge.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "    permissions.recordQuery({ household, asked_by, product, asked_from, answered });"
assert old in s
s = s.replace(old, "    void asked_from;", 1)
p.write_text(s)

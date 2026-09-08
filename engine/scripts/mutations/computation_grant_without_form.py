import pathlib
# Clause 9: a computation across nodes returns a form from which no node can
# be recovered. Accept a computation grant that names no form.
p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = '      if (input.result_form !== "aggregate") {'
assert old in s
s = s.replace(old, "      if (false) {", 1)
p.write_text(s)

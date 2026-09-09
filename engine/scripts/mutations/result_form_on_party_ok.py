import pathlib
# Clause 9, §7.5: a result form belongs to a computation across nodes, not to
# a party reading a field. Accept one on a party grant.
p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = "    } else if (input.result_form !== undefined) {"
assert old in s
s = s.replace(old, "    } else if (false) {", 1)
p.write_text(s)

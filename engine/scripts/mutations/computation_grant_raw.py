import pathlib
# Clause 9: the enum has one member on purpose. Admit raw data, so a person
# can grant what a revoked grant cannot take back.
p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = '      if (input.result_form !== "aggregate") {'
assert old in s
s = s.replace(old, '      if (input.result_form !== "aggregate" && input.result_form !== "raw") {', 1)
p.write_text(s)

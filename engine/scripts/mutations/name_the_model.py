import pathlib
# Clause 3: the model is one of the parts a member replaces. An offer that
# names the model it was drafted with has bound the offer to that part.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "    config_version: o.config_version,\n"
assert old in s
s = s.replace(old, old + '    model: "gpt-5",\n', 1)
p.write_text(s)

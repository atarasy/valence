import pathlib
# §6.5. The statement screen shows no lines, so a household signs a document
# that names nothing while the engine charges the collection's record. What is
# signed and what is shown come apart, which is the whole thing the statement
# exists to hold together.
p = pathlib.Path("src/hub/statement.ts"); s = p.read_text()
a = "    lines: proposed.map((l) => {"
assert a in s, "hub/statement.ts lines anchor has drifted"
s = s.replace(a, "    lines: [].map((l: typeof proposed[number]) => {", 1)
p.write_text(s)

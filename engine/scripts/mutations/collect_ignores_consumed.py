import pathlib
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
old = "    row.consumed = [...input.consumed];"
assert old in s, "anchor drifted"
s = s.replace(old, "    row.consumed = [];", 1)
s = s.replace("""    const both = input.returned.filter((id) => input.consumed.includes(id));
    if (both.length > 0) {""", """    const both: string[] = [];
    if (both.length > 0) {""", 1)
p.write_text(s)

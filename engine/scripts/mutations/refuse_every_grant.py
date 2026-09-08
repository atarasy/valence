import pathlib
p = pathlib.Path("src/permissions.ts"); s = p.read_text()
old = "    const action = this.actions.get(input.asked_from);"
assert old in s, "anchor drifted"
s = s.replace(old, "    const action = undefined as PendingAction | undefined;", 1)
p.write_text(s)

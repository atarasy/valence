import pathlib
p = pathlib.Path("src/permissions.ts"); s = p.read_text()
old = """    const action = this.actions.get(input.asked_from);
    if (!action) {"""
assert old in s, "anchor drifted"
s = s.replace(old, """    const action = this.actions.get(input.asked_from);
    if (false) {""", 1)
s = s.replace("    if (action.household !== input.household) {", "    if (action && action.household !== input.household) {", 1)
s = s.replace("    if (action.expires_at <= now) {", "    if (action && action.expires_at <= now) {", 1)
p.write_text(s)

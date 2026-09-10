import pathlib

# Clause 40. Revoking removes the row instead of marking it, so the household's
# ledger loses the record that the permission ever existed.
#
# Re-anchored 2026-09-11, when revoke gained the write-back its in-place change
# had been missing. The anchor now names that write so a future one cannot be
# inserted between the two lines this script had treated as adjacent.

p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = "    this.rows.set(household, list);\n    return permission;"
assert old in s, "permissions.ts revoke anchor has drifted"
s = s.replace(old, """    this.rows.set(household, list.filter((p) => p.id !== id));
    return permission;""", 1)
p.write_text(s)

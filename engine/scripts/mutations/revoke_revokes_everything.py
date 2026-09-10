import pathlib

# Clause 40. Revoking one permission revokes every permission the household
# holds, which is the opposite of a ledger a person can read and trust.
#
# Re-anchored 2026-09-11 with revoke_deletes_the_row, for the same reason.

p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = "    this.rows.set(household, list);\n    return permission;"
assert old in s, "permissions.ts revoke anchor has drifted"
s = s.replace(old, """    for (const p of list) p.revoked_at = now;
    this.rows.set(household, list);
    return permission;""", 1)
p.write_text(s)

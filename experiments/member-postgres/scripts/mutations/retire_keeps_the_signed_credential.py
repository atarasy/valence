import pathlib
# §10.5. Retire only the credentials that have signed nothing, so a
# deployment with two signed-in credentials is one no command can leave.
p = pathlib.Path('device-acceptance.ts'); s = p.read_text()
old = ' for(const id of [...proven,...unproven]){r.authority.removeCredential(id);r.login.removeEnrolledPasskey(id);}'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, ' for(const id of unproven){r.authority.removeCredential(id);r.login.removeEnrolledPasskey(id);}', 1)
p.write_text(s)

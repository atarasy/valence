import pathlib
# §10.5. Write the passkey before the authority can refuse the credential, so
# a refused enrolment's cleanliness depends on its caller's savepoint.
p = pathlib.Path('login.ts'); s = p.read_text()
old = '      authority.registerCredential(id, principal);\n      passkeys.insert(id,{id,public_key:Array.from(publicKey),counter,user_handle:userHandle,revision:0,active:0});'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      passkeys.insert(id,{id,public_key:Array.from(publicKey),counter,user_handle:userHandle,revision:0,active:0});\n      authority.registerCredential(id, principal);', 1)
p.write_text(s)

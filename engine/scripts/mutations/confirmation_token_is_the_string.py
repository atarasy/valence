import pathlib

# §10.5. Identify a confirmation by the string that was posted rather than by
# what it decodes to. `Buffer.from(x, "base64")` ignores whitespace and
# padding and reads the base64url alphabet, so one signature has an unbounded
# number of spellings and a register of strings holds none of the others; and
# an ECDSA signature has a twin that anyone who saw it can compute without the
# key. Either way a withdrawn set goes back.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = 'export function confirmationToken(publicKeyPem: string, signature: string): string {'
assert a in s, "decisions.ts confirmationToken anchor has drifted"
s = s.replace(a, a + "\n  return signature;", 1)
p.write_text(s)

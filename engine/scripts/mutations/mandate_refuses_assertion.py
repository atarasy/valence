import pathlib

# §16.1. Take a bare signature and nothing else on a mandate change, which is
# what the route did until 2026-09-11. A passkey cannot sign bytes a caller
# hands it, so a person who joined through a hub and holds one could record no
# ceiling, no cooling window and no co-signer, and §16.5 went with it: there is
# nothing to take a decided set back into.

p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
a = """        ok = verifyPersonal(
          bytes,
          signature !== undefined ? { signature } : { assertion: assertion! },
          pem,
          relyingPartyId
        );"""
assert a in s, "mandates.ts verifyPersonal anchor has drifted"
s = s.replace(a, """        void relyingPartyId;
        ok = signature !== undefined && verifyPersonal(bytes, { signature }, pem, relyingPartyId);""", 1)
p.write_text(s)

import pathlib
# §14.2 and §16.1, question 56, clause 47. Let a claim's version stand for the
# claim, so a household records **its own** terms at that version and drops the
# co-signers it named where the mandate came from: clause 47 escaped by
# relocation. Measured 2026-09-18.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    const claim = held && canonicalMandate(held, relyingPartyId).equals(canonicalMandate(mandate, relyingPartyId)) ? held : undefined;\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    const claim = held;\n', 1))

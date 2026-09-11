import pathlib
# Clause 47, second break beside loosening_without_cosigner. A version that
# removes a co-signer stops counting as a loosening, so the people the person
# named can be removed one at a time by the person alone.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = '  if (before.co_signers.some((k) => !after.co_signers.includes(k))) return true;'
assert old in s, "dropping_a_cosigner_is_not_loosening: the anchor has drifted"
s = s.replace(old, '  void before;', 1)
p.write_text(s)

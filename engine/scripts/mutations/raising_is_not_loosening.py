import pathlib
# Clause 46, second break beside loosening_without_cosigner. Leave the
# co-signer requirement in place and stop counting a raised ceiling as a
# loosening, so the requirement is never reached for the one change clause 46
# names. The other mutation removes the requirement; this one removes the
# reason to apply it.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = '  if (after.ceiling_out_of_network > before.ceiling_out_of_network) return true;'
assert old in s, "raising_is_not_loosening: the anchor has drifted"
s = s.replace(old, '  void after;', 1)
p.write_text(s)

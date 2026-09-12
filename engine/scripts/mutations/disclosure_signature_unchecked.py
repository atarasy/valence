import pathlib
# §10a.3. Trust the block on the offer without verifying it. A block this host
# recorded always verifies, so the loss is invisible until §14.2's import: an
# imported offer carries the blocks the sending host froze onto it, signed by
# keys this host may not hold, and the check is the only thing between those
# and a household's signature.
#
# **It is caught by the engine's own tests rather than by a probe**, for the
# reason `maker_outside_the_signed_catalogue` was retired: the conformance
# suite cannot present a block signed by a key the host lacks without importing
# an offer, which the disclosure suite does not do.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      const pem = this.identities.get(block.merchant);
      let ok = false;
      try {
        ok = pem !== undefined && verifyDisclosure(block, pem);
      } catch {
        ok = false;
      }"""
assert old in s, "disclosure_signature_unchecked: the anchor has drifted"
s = s.replace(old, """      const pem = this.identities.get(block.merchant);
      let ok = true;
      void pem;""", 1)
p.write_text(s)

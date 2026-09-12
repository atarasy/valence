import pathlib
# §6.5. The statement's signature is taken on faith: anything in the body
# settles the box. The route still refuses an empty body, so the mutation that
# removes the whole block is a different break from this one.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      if (!verifyPersonal(bytes, sent, householdKey, this.config.relyingPartyId)) {"
assert a in s, "offers.ts statement verify anchor has drifted"
s = s.replace(a, "      if (false) {", 1)
p.write_text(s)

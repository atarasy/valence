import pathlib

# §6.5. A household's signature over a box that has already settled is
# answered with the settlement that stands, rather than refused. **This is
# what the engine did until 2026-09-12**, on the reasoning that settling is
# idempotent: true of a presenter retrying after a timeout, and false of the
# person, whose signature is the application rather than a request for what
# already happened. Two tabs of one statement, the second disputing a line:
# the second tab read as signed, was told the first settlement's charge, and
# its dispute was recorded nowhere.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
# Re-anchored 2026-09-13, when the branch gained the comparison that lets a
# household's own identical bytes through. This removes the whole branch, so a
# signed body on a settled offer is answered with the standing settlement
# again; `settle_refuses_its_own_signature` removes only the comparison.
a = """      if (confirmation.signed) {
        // **The one thing that has to be asked before refusing: is this the
        // signature that settled it?** A household whose signed settle lost
        // its answer re-sends the same bytes, and this told it that its
        // signature "was not what settled it" when it is, byte for byte, with
        // the engine holding the proof. The hub carries no settlement read
        // that could have corrected the impression either. Measured by the
        // second refutation round on 2026-09-12, the night after the refusal
        // itself was written to close the two-tabs hole.
        const sent = confirmation.signed;
        const offered = "signature" in sent ? sent.signature : sent.assertion.signature;
        if (existing.confirmation !== null && existing.confirmation === offered) {
          return existing;
        }
        throw conflict(
          "already_settled",
          "this box has already settled, and this signature was not what settled it"
        );
      }
      return existing;"""
assert a in s, "offers.ts already-settled anchor has drifted"
s = s.replace(a, "      return existing;", 1)
p.write_text(s)

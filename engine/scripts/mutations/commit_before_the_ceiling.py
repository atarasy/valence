import pathlib

# §6, §16.3. The ledger commits before the daily ceiling is asked, so a
# refusal leaves the reservation committed while no settlement exists and the
# offer stays `decided`. `commit` is idempotent, so a retry returns the
# committed row and cannot undo it: on an adapter that moves money the
# household has been charged for a settlement that is not there. "Nothing is
# written on refusal" was false at the ledger until 2026-09-12.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """    // Past every refusal, so what the ledger is told and what the settlement
    // records are the same event.
    if (charged > 0) {
      await this.ledger.commit({ requestId: offer.id, amount: charged });
    } else if (this.ledger.get(offer.id)) {
      await this.ledger.release({ requestId: offer.id, reason: "nothing_kept" });
    }

"""
assert a in s, "offers.ts commit-after-refusal anchor has drifted"
s = s.replace(a, "", 1)
b = "    const charged = kept + consumed;\n"
assert b in s, "offers.ts charged anchor has drifted"
s = s.replace(b, b + """    if (charged > 0) {
      await this.ledger.commit({ requestId: offer.id, amount: charged });
    } else if (this.ledger.get(offer.id)) {
      await this.ledger.release({ requestId: offer.id, reason: "nothing_kept" });
    }
""", 1)
p.write_text(s)

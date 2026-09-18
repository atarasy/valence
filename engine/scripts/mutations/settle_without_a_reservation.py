import pathlib
# §14.2 and §6.4, question 57. Let a host settle at nothing an offer it holds
# no reserve for, as it did before the fifth refutation pass: an offer that
# travelled is then settled at both hosts, with two receipts for one offer.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (!this.ledger.get(offer.id)) {\n      throw conflict("no_reservation", `no reservation for ${offer.id} on this host; it settles where it was presented`);\n    }\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
old2 = '    } else {\n      await this.ledger.release({ requestId: offer.id, reason: "nothing_kept" });\n'
assert s.count(old2) == 1, "anchor drifted"
p.write_text(s.replace(old2, '    } else if (this.ledger.get(offer.id)) {\n      await this.ledger.release({ requestId: offer.id, reason: "nothing_kept" });\n', 1))

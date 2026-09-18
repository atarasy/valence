import pathlib
# §14.2 and §6.4, question 57. Take an offer whose money has not finished
# moving, so an offer that can still be decided or settled here holds no
# reservation on this ledger and §6.4's upper bound is one it has never seen.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (offer.state === "drafted" || offer.state === "presented" || offer.state === "decided" ||\n      (offer.state === "expired" && owesSettlement(offer))) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {\n', 1))

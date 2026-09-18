import pathlib
# §14.2 and §6.4, question 57. Take an offer that arrives still in progress, so
# an offer that can be decided here holds no reservation on this ledger and
# §6.4's upper bound is one this ledger has never seen.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (offer.state === "drafted" || offer.state === "presented") {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {\n', 1))

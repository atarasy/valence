import pathlib
# §11.2, question 46 (2026-09-14). A collection is accepted whatever the offer's
# state, so it rewrites a settled or withdrawn box: a consumed line nobody
# signed, a missing line nobody saw, or an overrule of a withdraw's own returns.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = 'if (offer.state !== "presented" && !(offer.state === "decided" && !this.settlements.has(offer.id))) {'
assert s.count(old) == 1, "collect state anchor drifted"
s = s.replace(old, "if (false) {", 1)
p.write_text(s)

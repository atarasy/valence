import pathlib
# §16.5, §11.2, question 46 (2026-09-14). A physical box may have its decisions
# withdrawn after a collection is recorded, so a household that kept an item can
# withdraw, re-decide it `returned`, and keep the goods for nothing while the
# collection is past and cannot contradict it.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = 'if (offer.binding === "physical" && this.recoveries.for(offer.id)?.collected_at != null) {'
assert s.count(old) == 1, "withdraw guard anchor drifted"
s = s.replace(old, "if (false) {", 1)
p.write_text(s)

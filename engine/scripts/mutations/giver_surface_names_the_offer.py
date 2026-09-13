import pathlib

# §7.2, clause 16. Add an offer field to /lineage/acts. The value is
# candidateIndex.get(edge.product) with an empty-string fallback. In the
# completed original 299 mutation log reviewed 2026-09-13, the observed value
# is empty: the actual-offer-id exclusion passes and the forbidden-field
# assertion fails. This is a response-shape catch, not evidence that a usable
# offer reference leaked or enabled statement/approval reads.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """      if (edge.kind === "gift") continue;
      acts.push(edge);"""
assert a in s, "offers.ts actsVisibleToGiver anchor has drifted"
s = s.replace(a, """      if (edge.kind === "gift") continue;
      acts.push({ ...edge, offer: this.candidateIndex.get(edge.product) ?? "" } as typeof edge);""", 1)
p.write_text(s)

import pathlib

# §7.2, clause 16. Each act on the giver's surface names the offer it came
# from. The schema of these surfaces was clean and **what kept a giver off the
# reads under an offer's path was that nothing handed a giver an offer id**:
# with one, `GET /offers/{id}/statement` lists the lines a collection found
# used and `GET /offers/{id}/approval` names every candidate, which is the
# signal clause 16 exists against. §12 had already shut the one route that
# would have handed one over; the rule generalising it was written on
# 2026-09-13 and this is what checks it.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """      if (edge.kind === "gift") continue;
      acts.push(edge);"""
assert a in s, "offers.ts actsVisibleToGiver anchor has drifted"
s = s.replace(a, """      if (edge.kind === "gift") continue;
      acts.push({ ...edge, offer: this.candidateIndex.get(edge.product) ?? "" } as typeof edge);""", 1)
p.write_text(s)

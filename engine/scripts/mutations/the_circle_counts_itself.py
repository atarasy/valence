import pathlib
# Section 7.7, second break beside lineage_acts_total, and on the circle
# rather than on the acts list. Each row carries how many edges the other
# party has, which is the network's size arriving one row at a time rather
# than as a total.
#
# Rewritten 2026-09-11. The first version built the degree map and never used
# it, so nothing in a response changed and the run reported SURVIVED when the
# truth was that there was nothing to catch. `mutate.sh` only asks whether the
# text of src changed, which dead code satisfies.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """    const rows = [];
    for (const edge of this.edges.values()) {
      const mine = edge.from === viewer;
      if (!mine && edge.to !== viewer) continue;
      rows.push({
        from: edge.from,
        to: edge.to,"""
assert old in s, "the_circle_counts_itself: the anchor has drifted"
new = """    const rows = [];
    const degree = new Map<string, number>();
    for (const e of this.edges.values()) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    for (const edge of this.edges.values()) {
      const mine = edge.from === viewer;
      if (!mine && edge.to !== viewer) continue;
      rows.push({
        degree: degree.get(mine ? edge.to : edge.from) ?? 0,
        from: edge.from,
        to: edge.to,"""
s = s.replace(old, new, 1)
p.write_text(s)

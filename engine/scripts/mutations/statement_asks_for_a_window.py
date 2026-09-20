import pathlib
# §16.5, decided 2026-09-20 after the third refutation pass over question 68.
# The window read before the settlement asks whether it can bar anything, so
# a hub predating question 68 refuses a statement settlement `hub_refused`,
# the statement stays unsigned and §6.5 blocks that presenter's next box.
# Measured by the pass on a household holding no mandate at all.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """    const fixed = this.decidedProtections.get(offer.id);
    if (!needsStatement(offer, missing) && offer.decided_at !== null) {
      const coolingSeconds = longerWindow("""
assert s.count(old) == 1, "anchor drifted"
new = """    const fixed = this.decidedProtections.get(offer.id);
    const askedAnyway = longerWindow(
      await this.coolingRead(offer.household, now),
      known(fixed?.cooling_seconds)
    );
    if (!needsStatement(offer, missing) && offer.decided_at !== null && askedAnyway !== undefined) {
      const coolingSeconds = longerWindow("""
s = s.replace(old, new, 1)
p.write_text(s)

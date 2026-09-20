import pathlib
# §16.3, decided 2026-09-20, re-anchored after the third refutation pass. One
# fallback covering both reads instead of one each, so a hub that answers
# `ceiling_daily` and not `cooling_seconds`, which is every hub predating
# question 68, records the ceiling it last read rather than the one live at
# the decision, and a loosening after the decision reaches the set.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """    const stale: ("cooling_seconds" | "ceiling_daily")[] = [];
    const cooling = await this.readOrLast("cooling_seconds", offer.household, () => this.coolingRead(offer.household, now));"""
assert s.count(old) == 1, "anchor drifted"
new = """    const stale: ("cooling_seconds" | "ceiling_daily")[] = [];
    const cooling = await this.readOrLast("cooling_seconds", offer.household, () => this.coolingRead(offer.household, now));
    if (cooling.stale) {
      const payer0 = offer.giver ?? offer.household;
      const last = await this.readOrLast("ceiling_daily", payer0, () => Promise.reject(new Error("one catch")));
      return mayOwe
        ? { at: now, cooling_seconds: cooling.value, ceiling_daily: last.value, stale: ["cooling_seconds", "ceiling_daily"] }
        : { at: now, cooling_seconds: cooling.value, stale: ["cooling_seconds"] };
    }"""
s = s.replace(old, new, 1)
p.write_text(s)

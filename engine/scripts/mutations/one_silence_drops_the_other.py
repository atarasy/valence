import pathlib
# §16.3, decided 2026-09-20. One catch over both reads instead of one each, so
# a hub that answers `ceiling_daily` and not `cooling_seconds` (which is every
# hub predating question 68) records neither, and a set decided under a daily
# ceiling of 500 is charged past it once that mandate lapses.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """    const cooling_seconds = await readOrUnknown(() => this.mandateSource.coolingSecondsOf(offer.household, now));
    if (!mayOwe) return { at: now, cooling_seconds };
    const ceiling_daily = await readOrUnknown(() => this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now));
    return { at: now, cooling_seconds, ceiling_daily };"""
assert s.count(old) == 1, "anchor drifted"
new = """    try {
      const cooling_seconds = await this.mandateSource.coolingSecondsOf(offer.household, now);
      if (!mayOwe) return { at: now, cooling_seconds };
      const ceiling_daily = await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now);
      return { at: now, cooling_seconds, ceiling_daily };
    } catch {
      return mayOwe ? { at: now, cooling_seconds: "unknown", ceiling_daily: "unknown" } : { at: now, cooling_seconds: "unknown" };
    }"""
s = s.replace(old, new, 1)
p.write_text(s)

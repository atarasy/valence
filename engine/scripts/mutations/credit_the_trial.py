import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
assert '  private readonly settlements = new Map<string, Settlement>();' in s
assert '    const charged = kept + consumed;' in s
# Accrue what was consumed and spend it down on the next settlement.
s = s.replace("  private readonly settlements = new Map<string, Settlement>();",
              "  private readonly settlements = new Map<string, Settlement>();\n  private readonly balances = new Map<string, number>();", 1)
s = s.replace("    const charged = kept + consumed;",
"""    const held = this.balances.get(offer.household) ?? 0;
    const charged = Math.max(0, kept + consumed - held);
    this.balances.set(offer.household, Math.max(0, held - kept) + consumed);""", 1)
p.write_text(s)

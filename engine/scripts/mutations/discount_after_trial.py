import pathlib
p=pathlib.Path("src/engine/offers.ts"); s=p.read_text()
assert '  private readonly settlements = new Map<string, Settlement>();' in s
assert '        unit_price: entry.price,' in s
assert '      } else if (c.valence === "consumed") {' in s
s=s.replace("  private readonly settlements = new Map<string, Settlement>();",
            "  private readonly settlements = new Map<string, Settlement>();\n  private readonly tried = new Set<string>();",1)
s=s.replace("        unit_price: entry.price,",
            "        unit_price: this.tried.has(input.household) ? Math.floor(entry.price * 0.9) : entry.price,",1)
s=s.replace('      } else if (c.valence === "consumed") {',
            '      } else if (c.valence === "consumed") {\n        this.tried.add(offer.household);',1)
p.write_text(s)

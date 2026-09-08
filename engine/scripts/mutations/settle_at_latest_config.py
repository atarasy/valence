import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
# Settle against the presenter's newest catalogue rather than the stamped one.
s = s.replace("""    const config = this.configs.get(offer.config_version);""",
"""    let config = this.configs.get(offer.config_version);
    for (const c of this.configs.values()) {
      if (c.presenter === offer.presenter) config = c;
    }""", 1)
s = s.replace("        kept += c.unit_price * c.quantity;",
              "        kept += (config!.products[c.product]?.price ?? c.unit_price) * c.quantity;", 1)
p.write_text(s)

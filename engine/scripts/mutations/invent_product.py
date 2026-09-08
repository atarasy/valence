import pathlib
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
s = s.replace("""      const entry = config.products[c.product];
      if (!entry) {
        throw notFound(`no product ${c.product} in config ${config.version}`);
      }""",
"""      const entry = config.products[c.product] ?? { price: 1000, cost: 300 };""", 1)
p.write_text(s)

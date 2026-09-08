import pathlib
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
s = s.replace("""    for (const d of decisions) {
      const candidate = offer.candidates.find((c) => c.id === d.candidate);""",
"""    if (decisions.length !== offer.candidates.length) {
      throw conflict("partial_decision", "decide every candidate at once");
    }
    for (const d of decisions) {
      const candidate = offer.candidates.find((c) => c.id === d.candidate);""", 1)
p.write_text(s)

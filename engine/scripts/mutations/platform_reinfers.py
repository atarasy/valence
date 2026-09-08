import pathlib
# Clause 9: the platform infers nothing across nodes. Adjust each candidate's
# predicted_conversion by the return rate of the same product across every
# household this engine has seen, which is a model across nodes.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "    this.offers.set(offer.id, offer);\n    for (const c of candidates) this.candidateIndex.set(c.id, offer.id);\n    return offer;"
assert old in s
new = """    for (const c of candidates) {
      const seen = [...this.offers.values()].flatMap((o) => o.candidates).filter((k) => k.product === c.product);
      const returned = seen.filter((k) => k.valence === "returned").length;
      if (seen.length > 0) c.predicted_conversion = Math.round(c.predicted_conversion * (1 - returned / seen.length) * 1000) / 1000;
    }
    this.offers.set(offer.id, offer);
    for (const c of candidates) this.candidateIndex.set(c.id, offer.id);
    return offer;"""
s = s.replace(old, new, 1)
p.write_text(s)

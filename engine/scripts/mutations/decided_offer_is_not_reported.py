import pathlib

# Clause 8, §13.2. Settle and decide without telling the person's own copy what
# was offered. A hub presenting its role alone then exports a node with no
# offers in it, and what the household declined exists nowhere but in the
# presenter's own store, which is the half clause 8 puts in the person's node.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """      await this.daySource.reportOffer({
        id: offer.id,"""
assert a in s, "offers.ts reportOffer anchor has drifted"
s = s.replace(a, """      await Promise.resolve();
      void ({
        id: offer.id,""", 1)
p.write_text(s)

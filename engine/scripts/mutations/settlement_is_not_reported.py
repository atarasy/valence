import pathlib

# §16.3, §13.2. Settle without telling the person's own copy. The daily ceiling
# then measures nothing on a split deployment, and a household's export loses
# the settlement it is entitled to hold. Everything still answers, which is why
# this needs a probe that reads one party after writing to the other.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """    await this.daySource.report({
      offer: offer.id,"""
assert a in s, "offers.ts report anchor has drifted"
s = s.replace(a, """    await Promise.resolve();
    void ({
      offer: offer.id,""", 1)
p.write_text(s)

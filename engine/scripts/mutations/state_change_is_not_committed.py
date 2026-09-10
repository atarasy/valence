import pathlib

# §13.2. Stop putting a changed offer back in the map, which is what every
# version between the store landing and 2026-09-11 did. Everything answers, the
# whole conformance corpus passes, and the disk keeps the offer in the state it
# was created in: a map writes through on `set` and cannot see a field of a
# value it handed out being assigned.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """  private commit(offer: Offer): Offer {
    this.offers.set(offer.id, offer);"""
assert a in s, "offers.ts commit anchor has drifted"
s = s.replace(a, """  private commit(offer: Offer): Offer {
    void offer;""", 1)
p.write_text(s)

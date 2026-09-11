import pathlib

# §14.2, clause 35. Let an import change an offer this host already holds. A
# node handed to a host then says an offer is decided and every candidate
# kept, with no signature anywhere, and settling it charges for goods nobody
# agreed to. Measured 2026-09-11 before the rule existed: an offer at
# `presented` became `decided` and settled for 6,000.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """    const existing = this.offers.get(offer.id);
    if (existing) {"""
assert a in s, "offers.ts import anchor has drifted"
s = s.replace(a, """    const existing = this.offers.get(offer.id);
    if (existing && existing.state === "settled") {""", 1)
p.write_text(s)

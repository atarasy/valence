import pathlib

# §6.5. Fabricate a zero-carriage delivery when the register has none, so a
# signed statement can settle a physical box without a delivery record.
# Removing only the refusal guard used to dereference undefined carriage;
# this target keeps settlement executable and tests the missing-record gate.
p = pathlib.Path("src/engine/offers.ts")
s = p.read_text()
a = "      const carried = await this.deliverySource.find(offer.id);"
assert s.count(a) == 1, "offers.ts delivery lookup anchor has drifted"
s = s.replace(a, "      const carried = (await this.deliverySource.find(offer.id)) ?? { carriage: 0 };", 1)
p.write_text(s)

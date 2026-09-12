import pathlib
# §10a.4. An offer carries no disclosure, so a person signs without seeing what
# the seller had to say. The blocks are recorded and simply not frozen onto the
# offer, which is the shape this arrives in when a deployment treats the
# disclosure as something to fetch later.
#
# Rewritten 2026-09-12, an hour after it was written. The first version
# prepended an empty map to the spread, which adds nothing and leaves the real
# one: it changed the text of src and changed no behaviour, so the run reported
# SURVIVED when there was nothing to catch. **That is the fourth no-op mutation
# written in one day**, after a return type, a map nobody read and a branch the
# route cannot reach, and the common cause is writing the break as the smallest
# textual insertion rather than as the behaviour it is supposed to remove.
# Re-anchored 2026-09-12 (evening), when the disclosure gained a product key and the settlement line gained `disputed` (questions 35 and 36).
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      disclosures: [
        ...new Map(
          candidates
            // §10a.5. The merchant's standing text, and beside it the block
            // for this product where the merchant registered one. The
            // product block carries only what differs, and the screen
            // renders it beside that product's line and nothing else.
            .flatMap((c) => [
              this.disclosures.get(disclosureKey(c.merchant, null)),
              this.disclosures.get(disclosureKey(c.merchant, c.product)),
            ])
            .filter((d): d is Disclosure => d !== undefined)
            .map((d) => [disclosureKey(d.merchant, d.product), d] as const)
        ).values(),
      ],"""
assert old in s, "disclosure_not_carried: the anchor has drifted"
s = s.replace(old, "      disclosures: [],", 1)
p.write_text(s)

import pathlib
# §10a.4. Leave the disclosures off the approval render, which is the screen a
# person signs from. **This is the shape the requirement arrived in**: when
# §10a was written the block reached `GET /offers/{id}` and stopped there,
# while a member's hub reads `GET /offers/{id}/approval`, so the requirement
# was satisfied on a surface nobody signs from and the probe that checked it
# was looking at the wrong one. Found on 2026-09-12, hours after the section
# was written, by asking whether the surface guarded is the surface used.
# Re-anchored 2026-09-12 (evening), when the block gained a product key (question 35).
# Re-anchored 2026-09-22, when the block gained an optional contact (question 72),
# and again the same day, when an absent contact stopped rendering as null.
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = """      disclosures: offer.disclosures.map((d) => ({
        merchant: d.merchant,
        product: d.product,
        version: d.version,
        items: d.items.map((i) => ({ label: i.label, value: i.value })),
        // Absent, not null, where the merchant gave none: a client from before
        // question 72 checks a block's keys exactly and would refuse a new one.
        ...(d.contact ? { contact: d.contact } : {}),
        signature: d.signature,
      })),
      candidates,"""
assert old in s, "disclosure_not_on_the_approval_screen: the anchor has drifted"
s = s.replace(old, """      disclosures: [],
      candidates,""", 1)
p.write_text(s)

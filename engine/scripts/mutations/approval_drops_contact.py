import pathlib
# Question 72. The approval, the screen a person signs from, drops the
# merchant's contact off its disclosure blocks. The offer still carries it,
# so the defect is on exactly the surface §10a.4 already refused to let this
# happen on for the rest of a block.
# Re-anchored 2026-09-22, when an absent contact stopped rendering as null.
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = """        items: d.items.map((i) => ({ label: i.label, value: i.value })),
        // Absent, not null, where the merchant gave none: a client from before
        // question 72 checks a block's keys exactly and would refuse a new one.
        ...(d.contact ? { contact: d.contact } : {}),
        signature: d.signature,"""
assert old in s, "approval_drops_contact: the anchor has drifted"
s = s.replace(
    old,
    """        items: d.items.map((i) => ({ label: i.label, value: i.value })),
        signature: d.signature,""",
    1,
)
p.write_text(s)

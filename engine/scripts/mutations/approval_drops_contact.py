import pathlib
# Question 72. The approval, the screen a person signs from, drops the
# merchant's contact off its disclosure blocks. The offer still carries it,
# so the defect is on exactly the surface §10a.4 already refused to let this
# happen on for the rest of a block.
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = """        items: d.items.map((i) => ({ label: i.label, value: i.value })),
        // Question 72. Rendered exactly as the merchant signed it, or null
        // when the merchant gave none.
        contact: d.contact ?? null,
        signature: d.signature,"""
assert old in s, "approval_drops_contact: the anchor has drifted"
s = s.replace(
    old,
    """        items: d.items.map((i) => ({ label: i.label, value: i.value })),
        signature: d.signature,""",
    1,
)
p.write_text(s)

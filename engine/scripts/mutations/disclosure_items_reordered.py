import pathlib
# §10a.2. The items come back sorted by label rather than in the order the
# merchant composed them. **Order is composition**: a surface that decides
# which of a seller's statements a person reads first has composed the notice
# it was rendering, and nothing about the text itself has to change for that.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "      items: d.items.map((i) => ({ label: i.label, value: i.value })),"
assert old in s, "disclosure_items_reordered: the anchor has drifted"
s = s.replace(old, "      items: [...d.items].sort((a, b) => (a.label < b.label ? -1 : 1)).map((i) => ({ label: i.label, value: i.value })),", 1)
p.write_text(s)

import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "    received.push({ ref: randomUUID(), at: edge.created_at });"
assert old in s, "anchor drifted: " + old
s = s.replace(old, "    received.push({ ref: randomUUID(), at: edge.created_at, product: edge.product, merchant: edge.merchant } as never);", 1)
p.write_text(s)

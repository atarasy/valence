import pathlib

# §10a.5. The statement's lines carry no block at all, so the screen a
# household signs a physical settlement from shows several merchants' blocks
# and nothing saying which governs which line.

p = pathlib.Path("src/hub/statement.ts"); s = p.read_text()
a = "        disclosure: governing(offer, c.merchant, c.product),\n"
assert a in s, "hub/statement.ts governing anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)

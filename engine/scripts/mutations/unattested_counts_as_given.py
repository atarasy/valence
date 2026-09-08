import pathlib
# §7.1: an unattested edge makes nothing known. Count it, so a stranger who
# registers a key can empty a household's exploration floor by writing edges.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "      if (edge.attested && edge.to === household && edge.product === product) return true;"
assert s.count(old) == 2
s = s.replace(old, "      if (edge.to === household && edge.product === product) return true;")
p.write_text(s)

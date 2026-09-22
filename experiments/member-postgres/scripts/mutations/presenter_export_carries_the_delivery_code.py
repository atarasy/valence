import pathlib
# VOX-11 (vault `72`), clause 49. Hand a shop its deliveries as they are held,
# carrier code included, which resolves to the household's address.
p = pathlib.Path('presenter-http.ts'); s = p.read_text()
old = "return d?[{offer:o.id,carriage:d.carriage,status:d.status}]:[];"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "return d?[d]:[];", 1)
p.write_text(s)

import pathlib
# §14.2, question 59. Take a delivery for an offer already carried without
# comparing its carriage and code to the row this host holds.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (!held || held.carriage !== d.carriage || held.code !== d.code) throw differs("delivery for", d.offer);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)

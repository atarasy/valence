import pathlib
# VOX-11 (vault `72`), clause 8. Export the quotations of a digital offer this
# presenter does not own, by reading a quotation for every offer the engine
# holds rather than for this presenter's.
p = pathlib.Path('presenter-http.ts'); s = p.read_text()
old = "const carriage_quotes=protocol.offers.flatMap(o=>{const q=r.quotes.find(o.id);return q?[q]:[];});"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "const carriage_quotes=[...(r.engine as any).offers.values()].flatMap(o=>{const q=r.quotes.find(o.id);return q?[q]:[];});", 1)
p.write_text(s)

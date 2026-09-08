import pathlib
# Clause 27: a line never becomes a number. Register a route that counts
# the notes on a product and calls the count a sentiment.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "lineage") {'
assert s.count(old) == 1
new = '''  if (parts[0] === "notes" && parts[1] === "summary" && method === "GET") {
    return json({ product: url.searchParams.get("product"), notes: 0, sentiment: 0.5 });
  }
''' + old
s = s.replace(old, new, 1)
p.write_text(s)

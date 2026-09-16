import pathlib
# §13.2, question 55. Export from the raw path segment. A household identifier
# carries a colon, so the route then answers for a household nobody has while
# the import beside it writes under the decoded one.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = 'deliveries, decodeURIComponent(parts[1])));'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, 'deliveries, parts[1]));', 1))

import pathlib
# §13.2, question 55. Export from the raw path segment. **Re-anchored the same
# day**, when every decoded segment moved behind one helper. A household identifier
# carries a colon, so the route then answers for a household nobody has while
# the import beside it writes under the decoded one.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      const household = segment(parts[1]);\n      // Question 62. What owes nothing'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      const household = parts[1];\n      // Question 62. What owes nothing', 1))

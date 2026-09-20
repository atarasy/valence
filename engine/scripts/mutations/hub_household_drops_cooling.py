import pathlib
# §13.1, §16.5, question 68. Answer the household route without the longest
# cooling window.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = "      cooling_seconds: longestCooling(held),\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)

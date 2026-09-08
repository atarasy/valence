import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "offers") {'
assert old in s, "anchor drifted"
s = s.replace(old, '''  if (parts[0] === "search" && method === "GET") {
    // Discovery, arriving as a convenience.
    return json({ results: [{ product: "tea-a", rank: 1 }] });
  }

  if (parts[0] === "offers") {''', 1)
p.write_text(s)

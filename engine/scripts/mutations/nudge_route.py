import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace('    if (method === "GET" && parts[1] === "circle") {',
'''    if (method === "POST" && parts[1] === "nudge") {
      return json({ nudged: true }, 202);
    }
    if (method === "GET" && parts[1] === "circle") {''', 1)
p.write_text(s)

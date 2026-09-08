import pathlib
e = pathlib.Path("src/engine/offers.ts"); s = e.read_text()
s = s.replace("    received.push({ ref: randomUUID(), at: edge.created_at });",
              "    received.push({ ref: edge.id, at: edge.created_at });", 1)
e.write_text(s)
h = pathlib.Path("src/http.ts"); t = h.read_text()
t = t.replace('    if (method === "GET" && parts[1] === "circle") {',
'''    if (method === "GET" && parts.length === 2 && parts[1]) {
      const found = engine.edge(parts[1]);
      if (found) return json(found);
    }
    if (method === "GET" && parts[1] === "circle") {''', 1)
h.write_text(t)

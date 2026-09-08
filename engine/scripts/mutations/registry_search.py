import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = """      for (const key of url.searchParams.keys()) {
        if (key !== "protocol" && key !== "mark") {"""
assert old in s, "anchor drifted"
s = s.replace(old, """      const q = url.searchParams.get("q");
      if (q !== null) {
        return json({
          entries: registry.list().filter((e) =>
            Object.values(e.endpoints).some((u) => u.includes(q))
          ),
        });
      }
      for (const key of url.searchParams.keys()) {
        if (key !== "protocol" && key !== "mark") {""", 1)
p.write_text(s)

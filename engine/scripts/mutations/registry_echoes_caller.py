import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = """      return json({
        entries: registry.list({
          protocol: (protocol as Protocol | null) ?? undefined,
          markOnly: url.searchParams.get("mark") === "true",
        }),
      });"""
assert old in s, "anchor drifted"
s = s.replace(old, """      return json({
        entries: registry.list({
          protocol: (protocol as Protocol | null) ?? undefined,
          markOnly: url.searchParams.get("mark") === "true",
        }),
        household: request.headers.get("x-household") ?? null,
      });""", 1)
p.write_text(s)

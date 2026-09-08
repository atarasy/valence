import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = """      return json({
        entries: registry.list({
          protocol: (protocol as Protocol | null) ?? undefined,
          markOnly: url.searchParams.get("mark") === "true",
        }),
      });"""
assert old in s, "anchor drifted"
s = s.replace(old, """      const who = request.headers.get("x-household") ?? "";
      const rows = registry.list({
        protocol: (protocol as Protocol | null) ?? undefined,
        markOnly: url.searchParams.get("mark") === "true",
      });
      // Put the entry whose key starts with the caller's last letter first.
      const last = who.slice(-1);
      rows.sort((a, b) => (a.merchant[0] === last ? -1 : b.merchant[0] === last ? 1 : 0));
      return json({ entries: rows });""", 1)
p.write_text(s)

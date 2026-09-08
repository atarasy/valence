import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace('  if (parts[0] === "offers") {',
              '  if (parts[0] === "segments" && method === "GET") {\n'
              '    return json({ segments: [] });\n  }\n\n'
              '  if (parts[0] === "offers") {', 1)
p.write_text(s)

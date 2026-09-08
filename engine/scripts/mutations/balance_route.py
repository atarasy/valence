import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace('  if (\n    parts[0] === "households" &&',
              '  if (parts[0] === "households" && parts[2] === "balance" && method === "GET") {\n'
              '    return json({ household: parts[1], balance: 0 });\n  }\n\n'
              '  if (\n    parts[0] === "households" &&', 1)
p.write_text(s)

import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace('  if (parts[0] === "offers") {',
              '  if (parts[0] === "discounts" && method === "POST") {\n'
              '    return json({ id: "discount-1", percent: 10 }, 201);\n  }\n\n'
              '  if (parts[0] === "offers") {', 1)
p.write_text(s)

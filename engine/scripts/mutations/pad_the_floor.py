import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
start = s.index("      if (c.is_exploration) {")
end = s.index("      return {", start)
p.write_text(s[:start] + s[end:])

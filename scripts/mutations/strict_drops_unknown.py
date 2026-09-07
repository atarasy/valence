import pathlib
p = pathlib.Path("src/validate.ts")
s = p.read_text()
start = s.index("  if (unknown.length > 0) {")
end = s.index("  }", s.index("    );", start)) + 4
s = s[:start] + "  for (const k of unknown) delete record[k];\n" + s[end:]
p.write_text(s)

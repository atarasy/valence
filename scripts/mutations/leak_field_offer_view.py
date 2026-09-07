import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace("    lineage: c.lineage,\n  };", "    lineage: c.lineage,\n    rating: 4,\n  };", 1)
p.write_text(s)

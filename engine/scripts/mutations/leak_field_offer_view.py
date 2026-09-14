import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace("    collected_as: collectedAs(recovery, c.id),\n  };", "    collected_as: collectedAs(recovery, c.id),\n    rating: 4,\n  };", 1)
p.write_text(s)

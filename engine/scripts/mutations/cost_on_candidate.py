import pathlib
p=pathlib.Path("src/http.ts"); s=p.read_text()
s=s.replace("    lineage: c.lineage,\n  };", "    lineage: c.lineage,\n    cost: Math.round(c.unit_price * 0.33),\n  };",1); p.write_text(s)

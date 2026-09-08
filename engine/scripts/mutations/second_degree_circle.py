import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("""      const mine = edge.from === viewer;
      if (!mine && edge.to !== viewer) continue;""",
"""      const mine = edge.from === viewer;
      const direct = mine || edge.to === viewer;
      const known = new Set<string>();
      for (const e of this.edges.values()) {
        if (e.from === viewer) known.add(e.to);
        if (e.to === viewer) known.add(e.from);
      }
      if (!direct && !(known.has(edge.from) || known.has(edge.to))) continue;""", 1)
p.write_text(s)

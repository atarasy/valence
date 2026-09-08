import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace('''    if (offer.purpose === "ceremonial" && undecided.length > 0) {
      const first = undecided[0]!;
      first.valence = "defaulted";
      first.decided_at = now;
    }
''', "")
p.write_text(s)

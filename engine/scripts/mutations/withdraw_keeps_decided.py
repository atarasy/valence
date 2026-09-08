import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("""    for (const c of offer.candidates) {
      if (c.valence === "offered") {
        c.valence = "returned";
        c.decided_at = now;
      }
    }
    offer.state = "withdrawn";""",
"""    offer.state = "withdrawn";""", 1)
p.write_text(s)

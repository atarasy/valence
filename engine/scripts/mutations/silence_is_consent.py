import pathlib
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
s = s.replace("""    for (const c of offer.candidates) {
      if (c.valence === "offered") {
        c.valence = "returned";
        c.decided_at = now;
      }
    }
    offer.state = "expired";""",
"""    for (const c of offer.candidates) {
      if (c.valence === "offered") {
        c.valence = "kept";
        c.kept_as = "order";
        c.decided_at = now;
      }
    }
    offer.state = "expired";""", 1)
p.write_text(s)

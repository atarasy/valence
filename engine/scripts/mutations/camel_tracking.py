import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace("    collected_as: collectedAs(recovery, c.id),\n  };",
              "    collected_as: collectedAs(recovery, c.id),\n"
              "    trackingId: \"t-1\",\n"
              "    stockRemaining: 3,\n"
              "    expiresInSeconds: 60,\n"
              "    starRating: 4,\n  };", 1)
p.write_text(s)

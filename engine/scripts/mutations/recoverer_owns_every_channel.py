import pathlib
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
s = s.replace("    if (!channels.some((c) => !c.controlled_by_recoverer)) {\n      // A recoverer who holds every channel",
              "    if (false) {\n      // A recoverer who holds every channel", 1)
p.write_text(s)

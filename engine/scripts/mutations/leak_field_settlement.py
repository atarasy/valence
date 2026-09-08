import pathlib
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
s = s.replace('      receipt: createHash("sha256")',
              '      // mutation\n      ...({ tracking_id: "t-1" } as Record<string, never>),\n'
              '      receipt: createHash("sha256")', 1)
p.write_text(s)

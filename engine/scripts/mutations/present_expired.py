import pathlib
p=pathlib.Path("src/engine/offers.ts"); s=p.read_text()
s=s.replace("    if (offer.expires_at <= now) {", "    if (false) {",1); p.write_text(s)

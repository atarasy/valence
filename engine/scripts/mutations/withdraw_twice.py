import pathlib
p=pathlib.Path("src/engine.ts"); s=p.read_text()
s=s.replace('    if (offer.state === "settled" || offer.state === "withdrawn") {', '    if (offer.state === "settled") {',1)
p.write_text(s)

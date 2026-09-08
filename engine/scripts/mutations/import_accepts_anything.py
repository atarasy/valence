import pathlib
p=pathlib.Path("src/http.ts"); s=p.read_text()
s=s.replace('if (!body_ || body_.format !== "valence-node/1") {', 'if (false) {',1); p.write_text(s)

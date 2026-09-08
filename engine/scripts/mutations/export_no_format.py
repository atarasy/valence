import pathlib
p=pathlib.Path("src/hub/node.ts"); s=p.read_text()
s=s.replace("    format: EXPORT_FORMAT_VERSION,", "    format: \"\",",1); p.write_text(s)

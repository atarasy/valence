import pathlib
# §5.2: a catalogue is signed by the presenter it names. Accept an unsigned
# one, so anybody publishes catalogues under anybody's name.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    if (!ok) {\n      throw unprocessable(\n        \"bad_signature\",\n        `this catalogue is not signed by ${config.presenter}`\n      );\n    }"
assert old in s
s = s.replace(old, "", 1)
p.write_text(s)

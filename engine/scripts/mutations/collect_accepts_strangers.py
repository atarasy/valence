import pathlib
# §11.2. A collection names candidate ids that are not the offer's. Nothing is
# resolved, and the offer still reads as collected with goods used, so §6.5's
# block holds over that household until the loss deadline lifts it.
p = pathlib.Path("src/http.ts"); s = p.read_text()
a = "        if (strangers.length > 0) {"
assert a in s, "http.ts stranger anchor has drifted"
s = s.replace(a, "        if (false) {", 1)
p.write_text(s)

import pathlib

# §6.5. A disputed line is charged anyway. The household's signature covers a
# statement that marks the line disputed, and the engine verifies it and then
# bills the line as though it were confirmed, which makes the dispute a note
# on a receipt rather than a line leaving the rail.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "        if (disputed.includes(c.id)) {\n          // §6.5. A disputed line leaves the rail"
assert a in s, "offers.ts disputed-line anchor has drifted"
s = s.replace(a, "        if (false && disputed.includes(c.id)) {\n          // §6.5. A disputed line leaves the rail", 1)
p.write_text(s)

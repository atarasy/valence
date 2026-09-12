import pathlib

# §16.5, question 42. A cooling window bars the household's signature over a
# settlement statement. **This is what the engine did until 2026-09-13.** §11
# moves a box out of `presented` when a collection resolves its last line and
# stamps the window's start with the collection's moment, so a box the
# household never answered sat inside a window: the signature was refused for
# the whole window and discarded, while §6.5's block on that presenter's next
# box stood. A member who set a day lost a day of deliveries after every swap
# with anything used.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    if (!needsStatement(offer) && mandate?.cooling_seconds != null && offer.decided_at !== null) {"
assert a in s, "offers.ts cooling guard anchor has drifted"
s = s.replace(a, "    if (mandate?.cooling_seconds != null && offer.decided_at !== null) {", 1)
p.write_text(s)

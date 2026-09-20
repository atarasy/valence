import pathlib
# §16.5, decided 2026-09-20 after the second refutation pass over question 68.
# A cooling window recorded at any length. A decided set keeps the window it
# was decided under, so thirty years recorded, a set decided, the window
# dropped a second later and alone, leaves that set unable to settle until
# 2056 under a mandate showing no window at all.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = "    if (mandate.cooling_seconds != null && mandate.cooling_seconds > MAX_COOLING_SECONDS) {"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    if (false && mandate.cooling_seconds != null && mandate.cooling_seconds > MAX_COOLING_SECONDS) {", 1)
p.write_text(s)

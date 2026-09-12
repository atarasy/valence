import pathlib

# §7.5b, 法11条1号. A second delivery record for an offer overwrites the
# carriage as well as the status. **This is what the register did until
# 2026-09-12**: a plain `rows.set` with nothing comparing the figure already
# there. The carriage is what the approval and the statement put in front of
# the household before it signed, and the signature covers the statement's
# lines rather than this figure, so a despatch update carrying a different
# amount rewrote what a person had read with no record that it had.

p = pathlib.Path("src/hub/delivery.ts"); s = p.read_text()
a = """    const before = this.rows.get(input.offer);
    if (before && before.carriage !== input.carriage) {
      throw unprocessable(
        "carriage_fixed",
        `this offer's carriage was recorded as ${before.carriage} and is what the household was shown`
      );
    }
"""
assert a in s, "delivery.ts carriage-fixed anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)

import pathlib

# §7.5b. The household import route overwrites a recorded carriage, bypassing
# the rule `record` enforces. **This is what the register did until
# 2026-09-13**, so the guard written the day before was true of one door and
# false of the other: measured at 500 recorded, 800 refused through `record`,
# and 800 read back after an import carrying it.

p = pathlib.Path("src/hub/delivery.ts"); s = p.read_text()
a = """      const before = this.rows.get(r.offer);
      if (before && before.carriage !== r.carriage) {
        throw unprocessable(
          "carriage_fixed",
          `this offer's carriage was recorded as ${before.carriage} and is what the household was shown`
        );
      }
"""
assert a in s, "delivery.ts importRows guard anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)

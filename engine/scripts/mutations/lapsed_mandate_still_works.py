import pathlib

# Clause 58: a standing mandate lapses unless renewed. Present on one anyway.
#
# Re-anchored 2026-09-11. The check used to be a call into the register
# (`this.mandates.mustGet`), and §13.1 replaced that with a read through the
# mandate source and an inline test, so this script stopped applying and went
# INERT the same day. `scripts/anchors.py` found it on its first run, which is
# the argument for that script.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      if (mandate.lapses_at <= now) {
        throw unprocessable("mandate_lapsed", `mandate ${offer.mandate} lapsed and was not renewed`);
      }
"""
assert old in s, "offers.ts lapse anchor has drifted"
s = s.replace(old, "      void now;\n", 1)
p.write_text(s)

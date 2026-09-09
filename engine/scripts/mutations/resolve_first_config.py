import pathlib

# §6.3: an offer uses the catalogue version it names.
#
# Resolve the presenter's EARLIEST catalogue whatever the offer named. This is
# the mutation the guard probe in `silence/` describes in its own note, and it
# is not the one `ignore_config_version` performs: that script resolves the
# NEWEST, which for this presenter is usually the version the probe asked for,
# so the probe passed and the note was wrong. Measured 2026-09-09.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    const config = this.configs.get(input.config_version);"
assert old in s, "offers.ts config-resolution anchor has drifted"
new = """    let config = this.configs.get(input.config_version);
    if (config) {
      for (const c of this.configs.values()) {
        if (c.presenter === config.presenter) { config = c; break; }
      }
    }"""
s = s.replace(old, new, 1)
p.write_text(s)

import pathlib
# §6.3: a settlement uses the version stamped on the offer, and an offer uses
# the version it names. Resolve the last registered matching catalogue instead,
# so a repricing reaches an offer that named the older one. The loop follows
# insertion order; it does not compare version numbers.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    const config = this.configs.get(input.config_version);"
assert old in s
new = """    let config = this.configs.get(input.config_version);
    if (config) {
      for (const c of this.configs.values()) {
        if (c.presenter === config.presenter) config = c;
      }
    }"""
s = s.replace(old, new, 1)
p.write_text(s)

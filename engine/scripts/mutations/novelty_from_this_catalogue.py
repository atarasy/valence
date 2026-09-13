import pathlib
# §5: what the presenter still has is counted over every catalogue it registered.
# Count over the catalogue this offer names, so an exhausted narrow catalogue
# triggers nothing_new even when another catalogue holds unseen products.
# The numerical exploration floor remains rate-based; this does not lower it.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    for (const cfg of this.configs.values()) {\n      if (cfg.presenter === config.presenter) {"
assert old in s
s = s.replace(old, "    for (const cfg of [config]) {\n      if (cfg.presenter === config.presenter) {", 1)
p.write_text(s)

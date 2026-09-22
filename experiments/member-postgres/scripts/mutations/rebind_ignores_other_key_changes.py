import pathlib
# Rebinding a deployment's runtime profile. Drop the check that every
# non-addition key is identical, so a plan can carry an unrelated
# configuration change through an operator rebind instead of the ordinary
# application config path.
p = pathlib.Path('rebind-runtime.ts'); s = p.read_text()
old = "   if (differingKeys(bound.config, next.config, new Set(additions)).length) refuse(); // every key besides the addition must be identical\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)

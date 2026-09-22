import pathlib
# Rebinding a deployment's runtime profile. Compare only the new config's
# keys, so a bound setting the new config drops is forgotten silently.
p = pathlib.Path('rebind-runtime.ts'); s = p.read_text()
old = " for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, " for (const key of Object.keys(next)) {\n", 1)
p.write_text(s)

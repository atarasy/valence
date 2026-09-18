import pathlib
# §16.1 and §14.2, question 56. Let the household state any version where a
# claim is held. A raw signature is not bound to a host, so any looser version
# the household ever signed could then be recorded over its own tighter claim.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (!before && !claim && mandate.version !== 1) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (!before && !claim && !held && mandate.version !== 1) {\n', 1))

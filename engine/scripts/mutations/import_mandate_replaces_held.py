import pathlib
# §16.1, question 52. Let an import write a mandate this host already holds. A
# body of tightenings alone is then taken unsigned, and a co-signer whose key
# nobody holds freezes the household out of its own mandate for good.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held) taken.delete(m.id);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
# The register now independently rejects an already-held identifier. Remove
# that second guard too; the existing unit probe then sees its claim replaced.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (this.rows.has(m.id) || this.claimFor(m.id, now)) return;\n'
assert s.count(old) == 1, "register guard anchor drifted"
p.write_text(s.replace(old, '', 1))

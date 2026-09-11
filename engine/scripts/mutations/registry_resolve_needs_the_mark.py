import pathlib
# Clause 55, second break beside registry_resolve_404. An entry resolves only
# when it carries the mark, so the directory answers for some merchants and
# not others. The mark attaches to software and hosts and gates nothing, and
# a resolver that consults it has made it a condition of being found.
p = pathlib.Path("src/shared/registry.ts"); s = p.read_text()
old = '    if (!entry) throw notFound(`no entry for ${merchant}`);'
assert old in s, "registry_resolve_needs_the_mark: the anchor has drifted"
s = s.replace(old, '    if (!entry || !entry.mark) throw notFound(`no entry for ${merchant}`);', 1)
p.write_text(s)

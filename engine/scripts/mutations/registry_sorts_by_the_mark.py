import pathlib
# Clause 55 and section 17.2, second break beside registry_featured and
# registry_accepts_sort. No flag is added and no parameter is accepted: the
# one order the registry has is changed so that marked entries come first.
# Key order is the only order that says nothing, and this is what it looks
# like when something is said quietly.
p = pathlib.Path("src/shared/registry.ts"); s = p.read_text()
old = '      .sort((a, b) => (a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0));'
assert old in s, "registry_sorts_by_the_mark: the anchor has drifted"
s = s.replace(old, '      .sort((a, b) => (a.mark === b.mark ? (a.merchant < b.merchant ? -1 : 1) : a.mark ? -1 : 1));', 1)
p.write_text(s)

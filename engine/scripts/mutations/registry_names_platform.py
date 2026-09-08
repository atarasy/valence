import pathlib
# Clause 6: no entry names a platform. Put one on every entry the registry
# returns, which is the field an agent would prefer on.
p = pathlib.Path("src/shared/registry.ts"); s = p.read_text()
old = "    if (!entry) throw notFound(`no entry for ${merchant}`);\n    return entry;"
assert old in s
s = s.replace(old, "    if (!entry) throw notFound(`no entry for ${merchant}`);\n    return { ...entry, platform: \"atarasy-hosted\" } as Entry;", 1)
old2 = "      .sort((a, b) => (a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0));"
assert old2 in s
s = s.replace(old2, old2[:-1] + "\n      .map((e) => ({ ...e, platform: \"atarasy-hosted\" }) as Entry);", 1)
p.write_text(s)

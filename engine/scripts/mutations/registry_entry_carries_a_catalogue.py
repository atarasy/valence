import pathlib
# Section 17.2, second break beside registry_products_on_entry, in the record
# rather than on the response. An entry gains what a merchant sells, which
# turns a directory that resolves into one that can be browsed, and browsing
# is ranking with the order left implicit.
p = pathlib.Path("src/shared/registry.ts"); s = p.read_text()
old = '    this.entries.set(input.merchant, entry);'
assert old in s, "registry_entry_carries_a_catalogue: the anchor has drifted"
s = s.replace(old, '    this.entries.set(input.merchant, { ...entry, products: ["tea", "coffee"] } as Entry);', 1)
p.write_text(s)

import pathlib

# Clause 2, §13.2. Give `/_identities` to the engine, so a hub presenting its
# role alone cannot take a key. It then holds nothing to verify a person's
# lineage edge or a mandate's signature against, and the root of identity has
# become the presenter's side's to keep.

p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
a = "      // and the contents were everyone's.\n      return \"either\";"
assert a in s, "roles.ts _identities anchor has drifted"
s = s.replace(a, "      // and the contents were everyone's.\n      return \"engine\";", 1)
p.write_text(s)

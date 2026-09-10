import pathlib

# §13.1. Swap the two roles, so an engine answers for the person's surface and
# a hub for the presenter's. Every route is still served somewhere, which is
# what makes this worth a mutation: a corpus that only checked "the route
# exists" would see nothing wrong.

p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
a = "export function answersFor(roles: ReadonlySet<Role>, parts: string[]): boolean {\n  const owner = ownerOf(parts);"
assert a in s, "roles.ts answersFor anchor has drifted"
s = s.replace(
    a,
    "export function answersFor(roles: ReadonlySet<Role>, parts: string[]): boolean {\n"
    "  const named = ownerOf(parts);\n"
    '  const owner = named === "engine" ? "hub" : named === "hub" ? "engine" : named;',
    1,
)
p.write_text(s)

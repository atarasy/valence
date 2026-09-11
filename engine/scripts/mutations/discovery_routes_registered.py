import pathlib
# Clause 1, second break beside routes_all_registered and narrower than it.
# Only the intent-layer routes are registered, which is the shape clause 1 is
# about: the infrastructure resolving becomes the infrastructure ranking, and
# it arrives under the name of a convenience rather than as a policy change.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "lineage") {'
assert old in s, "discovery_routes_registered: the anchor has drifted"
s = s.replace(old, '  if (["search", "discovery", "discover", "ranking", "recommendations", "trending"].includes(parts[0] ?? "")) {\n    return json({ results: [] });\n  }\n\n  if (parts[0] === "lineage") {', 1)
p.write_text(s)

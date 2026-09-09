import pathlib

# Clauses 1, 27 to 30, and specification §9.1. Every route the suites check for
# absence, registered at once.
#
# `absence/` generates one probe per route name from two loops, eleven names in
# all. Until 2026-09-09 only three of those eleven had a mutation behind them
# (POST /discounts, GET /segments, GET /search), so thirteen of the generated
# probes had never been shown to fail. Writing thirteen near-identical scripts
# would prove them one at a time; registering every route at once proves them
# together, and the router either holds a route or it does not, so nothing is
# lost by doing it in one.

p = pathlib.Path("src/http.ts"); s = p.read_text()
anchor = '  if (parts[0] === "offers") {'
assert anchor in s, "http.ts route-table anchor has drifted"

names = [
    "segments", "broadcast", "discounts", "ratings", "events",
    "search", "discovery", "discover", "ranking", "recommendations", "trending",
]
block = "".join(
    f'  if (parts[0] === "{n}") {{\n    return json({{ {n.replace("/", "_")}: [] }});\n  }}\n\n'
    for n in names
)
s = s.replace(anchor, block + anchor, 1)
p.write_text(s)

import pathlib
# Clause 55 and section 17.2. A caller who does not ask about the mark sees
# only the marked, which is the mark becoming a gate through a default rather
# than through a rule. Nobody writes that down as a policy; it arrives as the
# sense of a parameter.
#
# Rewritten 2026-09-11. The first version changed the filter inside the
# registry, on the assumption that `markOnly` could arrive undefined. It
# cannot: the route computes it as `get("mark") === "true"`, so it is always a
# boolean and both branches behaved identically. The run reported SURVIVED for
# a mutation that changed no behaviour at all. The sense of the parameter is
# where the default actually lives.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '          markOnly: url.searchParams.get("mark") === "true",'
assert old in s, "registry_hides_the_unmarked_by_default: the anchor has drifted"
s = s.replace(old, '          markOnly: url.searchParams.get("mark") !== "false",', 1)
p.write_text(s)

import pathlib

# §3, question 48. A line the collection found missing reads as used, which puts a charge on a household for goods that were not there.

p = pathlib.Path("src/shared/collected.ts"); s = p.read_text()
a = '  if ((recovery.missing ?? []).includes(candidate)) return "missing";'
assert a in s, "src/shared/collected.ts missing_collected_as_consumed anchor has drifted"
s = s.replace(a, '  if ((recovery.missing ?? []).includes(candidate)) return "consumed";', 1)
p.write_text(s)

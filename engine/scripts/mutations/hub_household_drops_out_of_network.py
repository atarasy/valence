import pathlib
# §13.1, §16.2, question 68. Answer the household route without the tightest
# out-of-network ceiling, which an engine holding no register reads there.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = "      ceiling_out_of_network: tightestOutOfNetworkCeiling(held),\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)

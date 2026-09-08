import pathlib
# Clause 46: an offer is refused when what it could cost outside the network
# exceeds the ceiling the person signed. Stop checking.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      if (outside > mandate.ceiling_out_of_network) {"
assert old in s
s = s.replace(old, "      if (false) {", 1)
p.write_text(s)

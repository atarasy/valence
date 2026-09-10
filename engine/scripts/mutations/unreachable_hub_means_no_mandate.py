import pathlib

# §13.1, and the direction that fails open. Read a hub that cannot be reached
# as a hub that holds no mandate: every protection then disappears the moment
# the network does, and the engine goes on placing offers with no ceiling.

p = pathlib.Path("src/engine/mandate-source.ts"); s = p.read_text()
a = '''      throw unprocessable(
        "hub_unreachable",'''
assert a in s, "mandate-source.ts unreachable anchor has drifted"
s = s.replace(a, '''      return undefined;
      throw unprocessable(
        "hub_unreachable",''', 1)
p.write_text(s)

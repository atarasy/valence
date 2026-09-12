import pathlib

# §13.1, §7.5b. A split deployment points the engine at its own register
# instead of at the hub's, so every screen rendered under an offer's path shows
# `carriage: null` while the hub holds a delivery. The register is the hub's
# and the routes are the engine's, which is the shape that needs the source at
# all; this puts back the state that had it.

p = pathlib.Path("src/server.ts"); s = p.read_text()
a = """  if (!roles.has("hub")) {
    engine.readDeliveriesFrom(new RemoteDeliveries(process.env.VALENCE_HUB_URL));
  }
"""
assert a in s, "server.ts remote delivery anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)

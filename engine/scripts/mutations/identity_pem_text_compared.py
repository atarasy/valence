import pathlib
# §13.2. Compare the PEM text rather than the key, so the same key wrapped
# differently answers `409 identity_exists` and the holder's own registration
# fails after somebody else filed it re-wrapped.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = 'ValenceEngine.sameKeyDer(existing) !== ValenceEngine.sameKeyDer(publicKeyPem)'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, 'existing !== publicKeyPem', 1))

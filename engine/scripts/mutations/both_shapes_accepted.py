import pathlib

# §10.5. Accept a decided set that carries a signature and an assertion both,
# refusing only one that carries neither. The engine then checks the signature
# and ignores the assertion, which leaves which of the two was checked to the
# implementation: a caller holding a weak confirmation beside a strong one
# gets the weaker read. The probe for this was written on 2026-09-11 with no
# mutation beside it, and was among the six never shown to fail.

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = "        if (hasSignature === hasAssertion) {"
assert a in s, "http.ts both-shapes anchor has drifted"
s = s.replace(a, "        if (!hasSignature && !hasAssertion) {", 1)
p.write_text(s)

import pathlib
# §10a.1. Let the request that creates an offer carry the disclosures, and put
# them on the offer. **A field through which a caller writes a seller's legal
# text is the same defect as one through which a caller writes a price** (§3.1),
# and it arrives the same way: as a convenience for a client that already holds
# the block.
#
# Rewritten 2026-09-12, hours after it was written, by a refutation pass. The
# first version only widened the body's allow-list, and nothing read the field,
# so what it proved was that unknown keys are rejected: a property `strict`
# gives every route, and not the one this mutation names. **It was caught and
# it was still the fifth break of the day that did not implement the defect it
# declared.**
p = pathlib.Path("src/http.ts"); s = p.read_text()
keys = """          "giver",
          "candidates",
        ],
        "offer"
      );"""
assert keys in s, "disclosure_from_the_request: the body anchor has drifted"
s = s.replace(keys, """          "giver",
          "candidates",
          "disclosures",
        ],
        "offer"
      );""", 1)
create = """        mandate: requireString(raw, "mandate", "offer"),
        candidates,
      });"""
assert create in s, "disclosure_from_the_request: the createOffer anchor has drifted"
s = s.replace(create, """        mandate: requireString(raw, "mandate", "offer"),
        candidates,
      });
      if (Array.isArray(raw.disclosures)) {
        offer.disclosures = raw.disclosures as typeof offer.disclosures;
      }""", 1)
p.write_text(s)

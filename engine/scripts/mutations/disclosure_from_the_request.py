import pathlib
# §10a.1. Let the request that creates an offer carry the disclosures, and take
# them from there. **A field through which a caller writes a seller's legal
# text is the same defect as a field through which a caller writes a price**
# (§3.1), and it arrives the same way: as a convenience for a client that
# already holds the block.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = """          "giver",
          "candidates",
        ],
        "offer"
      );"""
assert old in s, "disclosure_from_the_request: the anchor has drifted"
s = s.replace(old, """          "giver",
          "candidates",
          "disclosures",
        ],
        "offer"
      );""", 1)
p.write_text(s)

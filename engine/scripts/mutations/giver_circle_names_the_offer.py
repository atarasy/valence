import pathlib

# §7.2, clause 16. The circle names the offer each edge came from. Second break
# beside `giver_surface_names_the_offer`, which does the same to `/lineage/acts`.
#
# **Written 2026-09-13 because the probe asserts over two surfaces and only one
# of them had ever been shown to fail.** §7.2's rule is about every
# giver-facing surface, and the circle is the other one a giver reads: an edge
# there carries the merchant and the product already, so an offer id beside
# them hands over exactly the reference the statement and approval reads are
# keyed on. A rule proven on one of its two surfaces is proven on one of them.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """        // §7.1, clause 2. Shown rather than filtered: a viewer sees which of
        // their edges rest on a root and which are somebody's word.
        attested: edge.attested,
      });"""
assert a in s, "offers.ts circleFor anchor has drifted"
s = s.replace(
    a,
    """        // §7.1, clause 2. Shown rather than filtered: a viewer sees which of
        // their edges rest on a root and which are somebody's word.
        attested: edge.attested,
        offer: this.candidateIndex.get(edge.product) ?? "",
      } as (typeof rows)[number]);""",
    1,
)
p.write_text(s)

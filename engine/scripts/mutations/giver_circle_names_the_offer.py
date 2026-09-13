import pathlib

# §7.2, clause 16. Add an offer field to /lineage/circle. The value is
# candidateIndex.get(edge.product) with an empty-string fallback. In the
# completed original 299 mutation log reviewed 2026-09-13, the observed value
# is empty: the actual-offer-id exclusion passes and the forbidden-field
# assertion fails. This is a response-shape catch, not evidence that a usable
# offer reference leaked or enabled statement/approval reads.

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

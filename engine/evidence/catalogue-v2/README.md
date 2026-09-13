# Catalogue signature revision 2 checkpoint

The previous catalogue signature omitted physical eligibility. Revision 2 binds every declared product field and its presence in a domain-separated compact JSON array. See SPEC section 5.4 and the independent Python vectors in engine/test/fixtures/catalogue-v2-vectors.json.

New publications require revision 2. Publishers must re-sign a fresh configuration version; there is no legacy fallback. A verification marker is persisted atomically with each configuration. Unmarked restored rows remain exportable but cannot create new offers. Existing offers are unchanged and require separate migration review before legacy physical inventory resumes placement.

The implementation also snapshots verified configurations, preserves reserved product names through HTTP parsing and rejects inherited properties as product references. Household decision, statement and mandate signature formats are unchanged.

Validation: 143 unit tests passed, strict TypeScript passed, and the frozen conformance suite passed 278 tests with one conditional skip. Ten independent Python vectors match. All 301 existing mutation scripts have matching inspected anchors; 13 replacements remain outside that check. Three existing mutations were reanchored, with no new mutation or conformance probe. Only the catalogue malleability mutation was behaviourally replayed: its separator test failed as intended while six neighbouring tests passed. This is not a new corpus coverage measurement.

See validation.json for source and log hashes. The member-read experiment remains opt-in; real login, durable resource authority, private storage/recovery and authenticated operations remain separate work. Earlier response corpora and experiment validation records remain historical evidence against their original revisions.

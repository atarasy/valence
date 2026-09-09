import pathlib

# Clause 43, and §14.1: a shop leaves with its ledgers, and how each offer
# settled is the half a shop cannot rebuild from the offers alone.
#
# The three probes on this export assert the format, that configs and offers
# are non-empty, and that neither belongs to another presenter. Nothing asserts
# settlements or recoveries, so before 2026-09-10 this mutation survived and
# "leaving is possible and complete" rested on no probe at all.

p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
a = "    configs: engine.configsForPresenter(presenter),\n    offers,\n    settlements,"
assert a in s, "node.ts merchant-export anchor has drifted"
s = s.replace(a, "    configs: engine.configsForPresenter(presenter),\n    offers,\n    settlements: [],", 1)
p.write_text(s)

import pathlib

def replace_once(body: str, old: str, new: str) -> str:
    assert body.count(old) == 1, "floor bypass anchor drifted: " + old.splitlines()[0]
    return body.replace(old, new, 1)

h = pathlib.Path("src/http.ts")
s = h.read_text()
s = replace_once(s, '          "candidates",\n        ],\n        "offer"',
                 '          "candidates",\n          "exploration_floor_met",\n        ],\n        "offer"')
s = replace_once(s, "        candidates,\n      });",
                 "        candidates,\n        floorMet: raw.exploration_floor_met === true,\n      });")
e = pathlib.Path("src/engine/offers.ts")
t = e.read_text()
t = replace_once(t, "      is_exploration: boolean;\n      given_by: string | null;\n    }[];",
                 "      is_exploration: boolean;\n      given_by: string | null;\n    }[];\n    floorMet?: boolean;")
t = replace_once(t, "    if (marked < required) {", "    if (!input.floorMet && marked < required) {")
# Do not publish a partial mutation if any required replacement fails.
h.write_text(s)
e.write_text(t)

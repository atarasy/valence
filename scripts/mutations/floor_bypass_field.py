import pathlib
h = pathlib.Path("src/http.ts"); s = h.read_text()
s = s.replace('          "candidates",\n        ],\n        "offer"',
              '          "candidates",\n          "exploration_floor_met",\n        ],\n        "offer"', 1)
s = s.replace("        candidates,\n      });",
              "        candidates,\n        floorMet: raw.exploration_floor_met === true,\n      });", 1)
h.write_text(s)
e = pathlib.Path("src/engine.ts"); t = e.read_text()
t = t.replace("      is_exploration: boolean;\n    }[];",
              "      is_exploration: boolean;\n    }[];\n    floorMet?: boolean;", 1)
t = t.replace("    if (marked < required) {", "    if (!input.floorMet && marked < required) {", 1)
e.write_text(t)

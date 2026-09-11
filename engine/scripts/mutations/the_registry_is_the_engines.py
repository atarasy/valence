import pathlib
# Clause 1 and section 17, second break beside registry_needs_both_roles. The
# registry stops belonging to neither role and becomes the engine's, so a hub
# alone cannot resolve a merchant and a deployment that presents the person's
# side has to hold a presenter's surface to look one up. A directory that
# belongs to a side is a directory that side can shape.
p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
old = '    case "candidates":\n    case "presenters":\n      return "engine";'
assert old in s, "the_registry_is_the_engines: the anchor has drifted"
s = s.replace(old, '    case "registry":\n    case "candidates":\n    case "presenters":\n      return "engine";', 1)
p.write_text(s)

import pathlib
# entry.ts's failureReason(). Instead of falling back to the error's bare
# name for a message not on the safe list, return the message itself, which
# is exactly what the allow-list exists to stop a driver error from doing.
p = pathlib.Path('deployment/entry.ts'); s = p.read_text()
old = "if(error instanceof Error&&error.name)return error.name;"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "if(error instanceof Error)return error.message;", 1)
p.write_text(s)

import pathlib
# §10.5, question 55. Accept any single active credential for the statement
# step, so one that has signed nothing names the household.
p = pathlib.Path('device-acceptance.ts'); s = p.read_text()
old = ' if(proven.length!==1||unproven.length!==0)throw new AcceptanceError('
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, ' if(proven.length+unproven.length!==1)throw new AcceptanceError(', 1)
p.write_text(s)

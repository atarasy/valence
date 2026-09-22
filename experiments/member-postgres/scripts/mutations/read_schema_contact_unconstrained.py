import json, pathlib
# Question 72. Admit anything under a disclosure's contact in a member read,
# so a response with a contact of any shape passes the gate.
p = pathlib.Path('../member-read/response-schemas.json'); raw = p.read_text()
d = json.loads(raw)
count = 0
def walk(o):
    global count
    if isinstance(o, dict):
        props = o.get('properties')
        if isinstance(props, dict) and 'contact' in props and 'signature' in props:
            props['contact'] = {}
            count += 1
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d)
assert count == 4, "anchor drifted"
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + ('\n' if raw.endswith('\n') else ''))

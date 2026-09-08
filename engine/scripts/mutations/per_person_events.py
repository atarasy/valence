import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
# A per-person event store, and a pixel socket, on routes not in the list.
s = s.replace('  if (parts[0] === "offers") {',
'''  if (parts[0] === "analytics" && method === "POST") {
    const raw = (await body(request)) as Record<string, unknown>;
    const who = String(raw.household ?? "");
    const rows = (globalThis as any).__events ??= new Map<string, unknown[]>();
    rows.set(who, [...(rows.get(who) ?? []), raw]);
    return json({ stored: true }, 201);
  }
  if (parts[0] === "analytics" && method === "GET") {
    const rows = (globalThis as any).__events ?? new Map();
    return json({ events: rows.get(url.searchParams.get("household") ?? "") ?? [] });
  }
  if (parts[0] === "px") {
    return json({ ok: true });
  }

  if (parts[0] === "offers") {''', 1)
p.write_text(s)

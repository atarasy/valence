import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace('''    if (method === "POST" && parts.length === 1) {
      const raw = strict(
        await body(request),
        [
          "from",''','''    if (method === "POST" && parts.length === 1) {
      const ua = request.headers.get("user-agent") ?? "";
      if (!ua.startsWith("atarasy-reference/")) {
        return json({ error: "unknown_client", message: ua }, 403);
      }
      const raw = strict(
        await body(request),
        [
          "from",''', 1)
p.write_text(s)

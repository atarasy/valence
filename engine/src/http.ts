import { ValenceError, badRequest, notFound } from "./errors.js";
import type { ValenceEngine } from "./engine.js";
import {
  optionalUnitInterval,
  requireBoolean,
  requireEnum,
  requireInteger,
  requireString,
  strict,
} from "./validate.js";
import type { Candidate, KeptAs, Offer, Valence } from "./types.js";

const BINDINGS = ["physical", "digital"] as const;
const PURPOSES = [
  "gift",
  "replenish",
  "trial",
  "ceremonial",
  "assortment",
] as const;
const KEPT_AS = ["self", "gift", "order"] as const;
const VALENCES = [
  "offered",
  "kept",
  "returned",
  "consumed",
  "defaulted",
  "lost",
] as const;
const KINDS = ["gift", "return", "regift", "thanks"] as const;
const VISIBILITY = ["self", "self_and_recipient"] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

function candidateView(c: Candidate) {
  return {
    id: c.id,
    product: c.product,
    quantity: c.quantity,
    unit_price: c.unit_price,
    predicted_conversion: c.predicted_conversion,
    is_exploration: c.is_exploration,
    valence: c.valence,
    decided_at: c.decided_at,
    kept_as: c.kept_as,
    lineage: c.lineage,
  };
}

function offerView(o: Offer) {
  return {
    id: o.id,
    binding: o.binding,
    household: o.household,
    presenter: o.presenter,
    purpose: o.purpose,
    config_version: o.config_version,
    presented_at: o.presented_at,
    expires_at: o.expires_at,
    state: o.state,
    exploration_floor_met: o.exploration_floor_met,
    mandate: o.mandate,
    candidates: o.candidates.map(candidateView),
  };
}

export function createApp(engine: ValenceEngine) {
  return async function handle(request: Request): Promise<Response> {
    try {
      return await route(engine, request);
    } catch (err) {
      if (err instanceof ValenceError) {
        return json({ error: err.code, message: err.message }, err.status);
      }
      return json(
        { error: "internal", message: (err as Error).message },
        500
      );
    }
  };
}

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("malformed", "body is not valid JSON");
  }
}

async function route(
  engine: ValenceEngine,
  request: Request
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const method = request.method.toUpperCase();

  // ---- out of specification: the presenter's own catalogue ----------------
  // Registering a catalogue version and an attested key is deployment
  // plumbing, not part of the Valence surface. Kept under an underscore so it
  // is obvious that a conformance probe of §9 does not look here.
  if (parts[0] === "_presenter") {
    if (method === "POST" && parts[1] === "configs") {
      const raw = strict(
        await body(request),
        ["version", "presenter", "products"],
        "config"
      );
      const products = raw.products;
      if (typeof products !== "object" || products === null) {
        throw badRequest("malformed", "config: products must be an object");
      }
      const entries: Record<string, { price: number; cost: number }> = {};
      for (const [ref, value] of Object.entries(
        products as Record<string, unknown>
      )) {
        const entry = strict(value, ["price", "cost"], `product ${ref}`);
        entries[ref] = {
          price: requireInteger(entry, "price", `product ${ref}`, 0),
          cost: requireInteger(entry, "cost", `product ${ref}`, 0),
        };
      }
      return json(
        engine.registerConfig({
          version: requireString(raw, "version", "config"),
          presenter: requireString(raw, "presenter", "config"),
          products: entries,
        }),
        201
      );
    }
    if (method === "POST" && parts[1] === "identities") {
      const raw = strict(await body(request), ["key", "public_key"], "identity");
      engine.registerIdentity(
        requireString(raw, "key", "identity"),
        requireString(raw, "public_key", "identity")
      );
      return json({ ok: true }, 201);
    }
  }

  // ---- §9 -----------------------------------------------------------------

  if (parts[0] === "offers") {
    if (method === "POST" && parts.length === 1) {
      const raw = strict(
        await body(request),
        [
          "binding",
          "household",
          "purpose",
          "config_version",
          "expires_at",
          "mandate",
          "candidates",
        ],
        "offer"
      );
      const rawCandidates = raw.candidates;
      if (!Array.isArray(rawCandidates)) {
        throw badRequest("malformed", "offer: candidates must be an array");
      }
      const candidates = rawCandidates.map((c, i) => {
        const entry = strict(
          c,
          ["product", "quantity", "predicted_conversion", "is_exploration"],
          `candidate ${i}`
        );
        return {
          product: requireString(entry, "product", `candidate ${i}`),
          quantity: requireInteger(entry, "quantity", `candidate ${i}`, 1),
          predicted_conversion: optionalUnitInterval(
            entry,
            "predicted_conversion",
            `candidate ${i}`
          ),
          is_exploration: requireBoolean(
            entry,
            "is_exploration",
            `candidate ${i}`
          ),
        };
      });
      const offer = engine.createOffer({
        binding: requireEnum(raw, "binding", "offer", BINDINGS),
        household: requireString(raw, "household", "offer"),
        purpose: requireEnum(raw, "purpose", "offer", PURPOSES),
        config_version: requireString(raw, "config_version", "offer"),
        expires_at: requireInteger(raw, "expires_at", "offer", 0),
        mandate: requireString(raw, "mandate", "offer"),
        candidates,
      });
      return json(offerView(offer), 201);
    }

    if (method === "GET" && parts.length === 1) {
      const household = url.searchParams.get("household");
      if (!household) {
        throw badRequest("malformed", "household is required");
      }
      // §7.5 applies to lineage, and the same discipline is kept here: the
      // list carries no total and no ranking.
      return json({
        offers: engine.offersForHousehold(household).map(offerView),
      });
    }

    const id = parts[1];
    if (id && parts.length === 2 && method === "GET") {
      return json(offerView(engine.mustGet(id, Date.now())));
    }

    if (id && parts.length === 3) {
      const action = parts[2];
      if (method === "POST" && action === "present") {
        strict(await body(request), [], "present");
        return json(offerView(await engine.present(id)));
      }
      if (method === "POST" && action === "decisions") {
        const raw = strict(await body(request), ["decisions"], "decisions");
        const list = raw.decisions;
        if (!Array.isArray(list)) {
          throw badRequest("malformed", "decisions must be an array");
        }
        const decisions = list.map((d, i) => {
          const entry = strict(
            d,
            ["candidate", "valence", "kept_as", "lineage"],
            `decision ${i}`
          );
          return {
            candidate: requireString(entry, "candidate", `decision ${i}`),
            valence: requireEnum(
              entry,
              "valence",
              `decision ${i}`,
              VALENCES
            ) as Valence,
            kept_as:
              entry.kept_as === undefined
                ? undefined
                : (requireEnum(
                    entry,
                    "kept_as",
                    `decision ${i}`,
                    KEPT_AS
                  ) as KeptAs),
            lineage:
              entry.lineage === undefined
                ? undefined
                : requireString(entry, "lineage", `decision ${i}`),
          };
        });
        return json(offerView(engine.decide(id, decisions)));
      }
      if (method === "POST" && action === "settle") {
        strict(await body(request), [], "settle");
        return json(await engine.settle(id));
      }
      if (method === "POST" && action === "withdraw") {
        strict(await body(request), [], "withdraw");
        return json(offerView(await engine.withdraw(id)));
      }
      if (method === "POST" && action === "remind") {
        strict(await body(request), [], "remind");
        engine.remind(id);
        return json({ ok: true });
      }
    }
  }

  if (parts[0] === "candidates" && parts[2] === "note" && method === "POST") {
    const candidate = parts[1];
    if (!candidate) throw notFound("no candidate");
    const raw = strict(
      await body(request),
      ["author", "text", "visibility"],
      "note"
    );
    return json(
      engine.addNote({
        candidate,
        author: requireString(raw, "author", "note"),
        text: requireString(raw, "text", "note"),
        visibility: requireEnum(raw, "visibility", "note", VISIBILITY),
      }),
      201
    );
  }

  if (parts[0] === "lineage") {
    if (method === "POST" && parts.length === 1) {
      const raw = strict(
        await body(request),
        [
          "from",
          "to",
          "product",
          "merchant",
          "kind",
          "occasion",
          "receipt",
          "signature",
        ],
        "edge"
      );
      const edge = engine.acceptEdge({
        from: requireString(raw, "from", "edge"),
        to: requireString(raw, "to", "edge"),
        product: requireString(raw, "product", "edge"),
        merchant: requireString(raw, "merchant", "edge"),
        kind: requireEnum(raw, "kind", "edge", KINDS),
        occasion: requireString(raw, "occasion", "edge"),
        receipt: requireString(raw, "receipt", "edge"),
        signature: requireString(raw, "signature", "edge"),
      });
      return json(edge, 201);
    }
    if (method === "GET" && parts[1] === "acts") {
      const giver = url.searchParams.get("giver");
      if (!giver) throw badRequest("malformed", "giver is required");
      // §7.2. Acts only. No row names the gift it answers, and there is no
      // count, so nothing here reports that a recipient did not respond.
      return json({ acts: engine.actsVisibleToGiver(giver) });
    }
  }

  if (
    parts[0] === "households" &&
    parts[2] === "receipts" &&
    method === "GET" &&
    parts[1]
  ) {
    // §7.4. The fact of receipt, and nothing else.
    return json({ receipts: engine.receiptsFor(parts[1]) });
  }

  // §9.1. /segments, /broadcast, /discounts, /ratings, /events/track are not
  // registered above and are not special-cased here. They are absent for the
  // same reason any other unrouted path is.
  return json(
    { error: "no_such_route", message: `${method} ${path} is not a route` },
    404
  );
}

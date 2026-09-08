import { ValenceError, badRequest, notFound, conflict, unprocessable } from "./errors.js";
import type { ValenceEngine } from "./engine.js";
import { exportNode, type NodeExport, type RecoveryRegister, exportMerchant } from "./node.js";
import { EXCLUSION_RULES, type ApprovalDesk, type ExclusionRule } from "./approval.js";
import type { PermissionLedger } from "./permissions.js";
import { PROTOCOLS, type Protocol, type Registry } from "./registry.js";
import {
  optionalUnitInterval,
  requireBoolean,
  requireEnum,
  requireInteger,
  requireString,
  strict,
} from "./validate.js";
import type {
  Candidate,
  CatalogueEntry,
  KeptAs,
  Offer,
  Valence,
  NoteParty,
} from "./types.js";

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
const NOTE_PARTIES = ["recipient", "merchant"] as const;

/**
 * §6.2. A candidate names its giver when it was given; the field is optional
 * and null by default, since most candidates are goods offered for sale.
 */
function optionalGiver(entry: Record<string, unknown>, where: string): string | null {
  if (entry.given_by === undefined || entry.given_by === null) return null;
  if (typeof entry.given_by !== "string" || entry.given_by === "") {
    throw badRequest("malformed", `${where}: given_by names a giver`);
  }
  return entry.given_by;
}

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
    merchant: c.merchant,
    ships: c.ships,
    predicted_conversion: c.predicted_conversion,
    is_exploration: c.is_exploration,
    given_by: c.given_by,
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
    price_band: o.price_band,
    giver: o.giver,
    config_version: o.config_version,
    presented_at: o.presented_at,
    expires_at: o.expires_at,
    state: o.state,
    exploration_floor_met: o.exploration_floor_met,
    mandate: o.mandate,
    candidates: o.candidates.map(candidateView),
  };
}

export type Hub = {
  recovery: RecoveryRegister;
  approvals: ApprovalDesk;
  permissions: PermissionLedger;
  registry: Registry;
};

export function createApp(engine: ValenceEngine, hub: Hub) {
  return async function handle(request: Request): Promise<Response> {
    try {
      return await route(engine, hub, request);
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
  hub: Hub,
  request: Request
): Promise<Response> {
  const { recovery, approvals, permissions, registry } = hub;
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
      const entries: Record<string, CatalogueEntry> = {};
      for (const [ref, value] of Object.entries(
        products as Record<string, unknown>
      )) {
        const entry = strict(value, ["merchant", "ships", "price", "physical"], `product ${ref}`);
        const physicalRaw = entry.physical;
        let physical;
        if (physicalRaw !== undefined) {
          const e = strict(
            physicalRaw,
            ["ambient", "keeps_for_days", "fits_ten_per_container", "regulated"],
            `product ${ref} eligibility`
          );
          physical = {
            ambient: requireBoolean(e, "ambient", `product ${ref}`),
            keeps_for_days: requireInteger(e, "keeps_for_days", `product ${ref}`, 0),
            fits_ten_per_container: requireBoolean(e, "fits_ten_per_container", `product ${ref}`),
            regulated: requireBoolean(e, "regulated", `product ${ref}`),
          };
        }
        entries[ref] = {
          // Clauses 11 and 12. A catalogue entry that names no maker and no
          // carrier is refused: the merchant is never hidden, and hiding
          // starts at the catalogue.
          merchant: requireString(entry, "merchant", `product ${ref}`),
          ships: requireString(entry, "ships", `product ${ref}`),
          price: requireInteger(entry, "price", `product ${ref}`, 0),
          physical,
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
      const raw = strict(await body(request), ["key", "public_key", "attested"], "identity");
      // §7.1. `attested` says an identity root endorsed this key. It is a
      // fixture flag here: who endorses a key is clause 2's root and not the
      // engine's business, and a conforming host reads it from that root.
      engine.registerIdentity(
        requireString(raw, "key", "identity"),
        requireString(raw, "public_key", "identity"),
        raw.attested === true
      );
      return json({ ok: true }, 201);
    }
  }

  // Out of specification: naming recoverers and their notification channels.
  // Who a household's recoverers are is open question 17, so the shape is
  // here and the choice is not.
  if (parts[0] === "_node") {
    if (method === "POST" && parts[1] === "recoverers") {
      const raw = strict(await body(request), ["household", "keys"], "recoverers");
      const keys = raw.keys;
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
        throw badRequest("malformed", "keys must be an array of strings");
      }
      recovery.nameRecoverers(
        requireString(raw, "household", "recoverers"),
        keys as string[]
      );
      return json({ ok: true }, 201);
    }
    if (method === "POST" && parts[1] === "channels") {
      const raw = strict(await body(request), ["household", "channels"], "channels");
      const channels = raw.channels;
      if (!Array.isArray(channels)) {
        throw badRequest("malformed", "channels must be an array");
      }
      const parsed = channels.map((c, i) => {
        const entry = strict(c, ["channel", "controlled_by_recoverer"], `channel ${i}`);
        return {
          channel: requireString(entry, "channel", `channel ${i}`),
          controlled_by_recoverer: requireBoolean(
            entry,
            "controlled_by_recoverer",
            `channel ${i}`
          ),
        };
      });
      try {
        recovery.registerChannels(
          requireString(raw, "household", "channels"),
          parsed
        );
      } catch (err) {
        throw unprocessable("no_independent_channel", (err as Error).message);
      }
      return json({ ok: true }, 201);
    }
  }

  // ---- §16: the endpoint registry -----------------------------------------
  // Resolves and does not rank. Every refusal below is the line in §16.2.
  if (parts[0] === "registry") {
    if (method === "POST" && parts[1] === "attest") {
      // Out of specification: attesting a merchant key is identity-root plumbing.
      const raw = strict(await body(request), ["merchant", "public_key"], "attest");
      registry.attest(
        requireString(raw, "merchant", "attest"),
        requireString(raw, "public_key", "attest")
      );
      return json({ ok: true }, 201);
    }
    if (method === "POST" && parts.length === 1) {
      const raw = strict(
        await body(request),
        ["merchant", "endpoints", "mark", "signature"],
        "entry"
      );
      const endpointsRaw = raw.endpoints;
      if (typeof endpointsRaw !== "object" || endpointsRaw === null) {
        throw badRequest("malformed", "endpoints must be an object");
      }
      const endpoints = strict(endpointsRaw, PROTOCOLS, "endpoints") as Partial<
        Record<Protocol, string>
      >;
      return json(
        registry.register({
          merchant: requireString(raw, "merchant", "entry"),
          endpoints,
          mark: requireBoolean(raw, "mark", "entry"),
          signature: requireString(raw, "signature", "entry"),
        }),
        201
      );
    }
    if (method === "GET" && parts.length === 1) {
      // §16.2. The only parameters are a protocol and, by name, the mark.
      // Anything a person would type when they want something is not one.
      for (const key of url.searchParams.keys()) {
        if (key !== "protocol" && key !== "mark") {
          throw notFound(`${key} is not a registry parameter`);
        }
      }
      const protocol = url.searchParams.get("protocol");
      if (protocol !== null && !PROTOCOLS.includes(protocol as Protocol)) {
        throw badRequest("malformed", `unknown protocol ${protocol}`);
      }
      return json({
        entries: registry.list({
          protocol: (protocol as Protocol | null) ?? undefined,
          markOnly: url.searchParams.get("mark") === "true",
        }),
      });
    }
    if (method === "GET" && parts.length === 2 && parts[1]) {
      return json(registry.resolve(parts[1]));
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
          "price_band",
          "giver",
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
          ["product", "quantity", "predicted_conversion", "is_exploration", "given_by"],
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
          given_by: optionalGiver(entry, `candidate ${i}`),
        };
      });
      let priceBand = null;
      if (raw.price_band !== undefined && raw.price_band !== null) {
        const band = strict(raw.price_band, ["min", "max"], "price_band");
        priceBand = {
          min: requireInteger(band, "min", "price_band", 0),
          max: requireInteger(band, "max", "price_band", 0),
        };
        if (priceBand.max < priceBand.min) {
          throw badRequest("malformed", "price_band: max is below min");
        }
      }
      const giverRaw = raw.giver;
      if (giverRaw !== undefined && giverRaw !== null && typeof giverRaw !== "string") {
        throw badRequest("malformed", "giver must be a string");
      }
      const offer = engine.createOffer({
        price_band: priceBand,
        giver: (giverRaw as string | undefined) ?? null,
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
      const presenter = url.searchParams.get("presenter");
      if (!household || !presenter) {
        throw badRequest("malformed", "household and presenter are required");
      }
      // §7.6 applies to lineage, and the same discipline is kept here: the
      // list carries no total and no ranking. Clause 8: it is one presenter's
      // view, never the household's union.
      return json({
        offers: engine.offersForHousehold(household, presenter).map(offerView),
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
        const raw = strict(await body(request), ["decisions", "signature"], "decisions");
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
        return json(offerView(engine.decide(id, decisions, requireString(raw, "signature", "decisions"))));
      }
      if (method === "GET" && action === "approval") {
        // Clause 54. Data, never presentation. The hub draws the screen.
        const rendered = approvals.render(engine, engine.mustGet(id, Date.now()));
        if ("missing" in rendered) {
          throw unprocessable("no_deliberation", rendered.missing);
        }
        return json(rendered);
      }
      if (method === "POST" && action === "deliberation") {
        const raw = strict(
          await body(request),
          ["per_candidate", "excluded", "mandate"],
          "deliberation"
        );
        const per = raw.per_candidate;
        if (typeof per !== "object" || per === null) {
          throw badRequest("malformed", "per_candidate must be an object");
        }
        const perCandidate: Record<
          string,
          { alternatives: string[]; argument_against: string }
        > = {};
        for (const [key, value] of Object.entries(per as Record<string, unknown>)) {
          const entry = strict(
            value,
            ["alternatives", "argument_against"],
            `candidate ${key}`
          );
          const alternatives = entry.alternatives;
          if (
            !Array.isArray(alternatives) ||
            alternatives.some((a) => typeof a !== "string")
          ) {
            throw badRequest("malformed", `candidate ${key}: alternatives must be strings`);
          }
          perCandidate[key] = {
            alternatives: alternatives as string[],
            argument_against: requireString(entry, "argument_against", `candidate ${key}`),
          };
        }
        const excludedRaw = raw.excluded;
        if (!Array.isArray(excludedRaw)) {
          throw badRequest("malformed", "excluded must be an array");
        }
        const excluded = excludedRaw.map((e, i) => {
          const entry = strict(e, ["product", "reason"], `excluded ${i}`);
          const reason = requireString(entry, "reason", `excluded ${i}`);
          // Clause 6: an exclusion names the published rule that made it.
          if (!(EXCLUSION_RULES as readonly string[]).includes(reason)) {
            throw badRequest(
              "unknown_rule",
              `excluded ${i}: reason must be one of ${EXCLUSION_RULES.join(", ")}`
            );
          }
          return { product: requireString(entry, "product", `excluded ${i}`), reason: reason as ExclusionRule };
        });
        const mandateRaw = strict(
          raw.mandate,
          ["kind", "scope", "lapses_at"],
          "mandate"
        );
        const kind = requireEnum(mandateRaw, "kind", "mandate", [
          "standing",
          "individual",
        ] as const);
        const lapses = mandateRaw.lapses_at;
        if (kind === "standing" && typeof lapses !== "number") {
          // Clause 58. A standing mandate lapses unless renewed, so there is
          // no way to record one that does not.
          throw unprocessable(
            "standing_must_lapse",
            "a standing mandate carries lapses_at"
          );
        }
        approvals.record({
          offer: id,
          perCandidate,
          excluded,
          mandate: {
            kind,
            scope: requireString(mandateRaw, "scope", "mandate"),
            lapses_at: typeof lapses === "number" ? lapses : null,
          },
        });
        return json({ ok: true }, 201);
      }
      if (method === "GET" && action === "recovery") {
        // §11. What the route is due to do, and what it found.
        const row = engine.recoveries.for(id);
        if (!row) throw notFound(`offer ${id} has no recovery`);
        return json(row);
      }
      if (method === "POST" && action === "recovery") {
        const raw = strict(
          await body(request),
          ["returned", "consumed"],
          "recovery"
        );
        for (const key of ["returned", "consumed"] as const) {
          const list = raw[key];
          if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) {
            throw badRequest("malformed", `${key} must be an array of candidate ids`);
          }
        }
        const collected = engine.recoveries.collect({
          offer: id,
          returned: raw.returned as string[],
          consumed: raw.consumed as string[],
          at: Date.now(),
        });
        // The collection is what the household never said. Apply it now so a
        // settlement after this call sees the valences it produced.
        engine.applyRecoveryTo(id);
        return json(collected);
      }
      if (method === "GET" && action === "settlement") {
        // §6. A receipt a household cannot ask for again is a receipt it can
        // lose by closing a tab.
        const settlement = engine.settlement(id);
        if (!settlement) throw notFound(`offer ${id} has no settlement`);
        return json(settlement);
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
      ["author", "text", "shared_with"],
      "note"
    );
    // Clause 27. The writer says who else sees the line, at the moment of
    // writing it: the recipient, the merchant, both or neither.
    // Clause 27. The recipient sees the line unless the writer says not to:
    // a line written before giving is the message that accompanies the gift,
    // which is the only reason the field exists, and a default of nobody
    // would make the writer opt in to the thing they were writing for. The
    // merchant is the other way round, since a merchant is a party to the
    // trade and not to the gift.
    const sharedRaw = raw.shared_with === undefined ? ["recipient"] : raw.shared_with;
    if (!Array.isArray(sharedRaw)) {
      throw badRequest("malformed", "note: shared_with must be an array");
    }
    const shared_with = sharedRaw.map((p) => {
      if (typeof p !== "string" || !(NOTE_PARTIES as readonly string[]).includes(p)) {
        throw badRequest("malformed", `note: shared_with names ${NOTE_PARTIES.join(" or ")}`);
      }
      return p as NoteParty;
    });
    if (new Set(shared_with).size !== shared_with.length) {
      throw badRequest("malformed", "note: shared_with repeats a party");
    }
    return json(
      engine.addNote({
        candidate,
        author: requireString(raw, "author", "note"),
        text: requireString(raw, "text", "note"),
        shared_with,
      }),
      201
    );
  }

  // Clause 27. What a party other than the writer may read of a candidate's
  // notes: the lines the writer chose to share with that party, and nothing
  // else. There is no route that aggregates notes across candidates.
  if (parts[0] === "candidates" && parts[2] === "note" && method === "GET") {
    const candidate = parts[1];
    if (!candidate) throw notFound("no candidate");
    const as = url.searchParams.get("as");
    if (!as || !(NOTE_PARTIES as readonly string[]).includes(as)) {
      throw badRequest("malformed", `as= names ${NOTE_PARTIES.join(" or ")}`);
    }
    const notes = engine.notesSharedWith(candidate, as as NoteParty);
    if (notes.length === 0) throw notFound("no note shared with that party");
    return json({ notes: notes.map((n) => ({ text: n.text, created_at: n.created_at })) });
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
    if (method === "GET" && parts[1] === "circle") {
      const viewer = url.searchParams.get("viewer");
      if (!viewer) throw badRequest("malformed", "viewer is required");
      // §7.6 and clause 21. No count, no network size, no ranking.
      return json({ edges: engine.circleFor(viewer) });
    }
    if (method === "GET" && parts[1] === "acts") {
      const giver = url.searchParams.get("giver");
      if (!giver) throw badRequest("malformed", "giver is required");
      // §7.2. Acts only. No row names the gift it answers, and there is no
      // count, so nothing here reports that a recipient did not respond.
      return json({ acts: engine.actsVisibleToGiver(giver) });
    }
  }

  if (parts[0] === "households" && parts[1] && parts[2] === "actions") {
    // Out of specification: opening an action a permission can be asked for.
    if (method === "POST") {
      const raw = strict(await body(request), ["describes", "expires_at"], "action");
      return json(
        permissions.openAction({
          household: parts[1],
          describes: requireString(raw, "describes", "action"),
          expiresAt: requireInteger(raw, "expires_at", "action", 0),
        }),
        201
      );
    }
  }

  // Clause 20, §4.2 of the hub surfaces. Duplicate avoidance: the one read
  // path that consults the permission ledger. A giver about to give asks
  // whether this household already has this product, and gets one bit, only
  // under a grant this household gave that giver for this use, only against
  // a live action, and the asking is written into the household's own record.
  // Until 2026-09-09 the ledger was a list no route read, so eleven probes
  // proved properties of something nothing consulted.
  // Clauses 5 and 43. A shop leaves with its ledgers: every catalogue version,
  // every offer it made, how each settled, its own recovery rows, and the
  // lines households chose to share with it. Nothing of another presenter's.
  if (parts[0] === "presenters" && parts[1] && parts[2] === "export" && method === "GET") {
    return json(exportMerchant(engine, decodeURIComponent(parts[1])));
  }

  if (parts[0] === "households" && parts[1] && parts[2] === "duplicate-check" && method === "POST") {
    const household = decodeURIComponent(parts[1]);
    const raw = strict(await body(request), ["product", "asked_by", "asked_from"], "duplicate check");
    const asked_by = requireString(raw, "asked_by", "duplicate check");
    const product = requireString(raw, "product", "duplicate check");
    const asked_from = requireString(raw, "asked_from", "duplicate check");
    if (!permissions.allows({ household, grantee: asked_by, field: "duplicate_check" })) {
      throw unprocessable(
        "no_grant",
        "the recipient alone decides whether this query runs, and has granted nothing to this giver"
      );
    }
    const answered = engine.hasBeenGiven(household, product);
    // The row is written before the answer is returned: a query that could be
    // asked without appearing in the record is a read of the list nobody sees.
    permissions.recordQuery({ household, asked_by, product, asked_from, answered });
    return json({ already_received: answered });
  }

  // §4.2. Who asked what, in the recipient's own record.
  if (parts[0] === "households" && parts[1] && parts[2] === "queries" && method === "GET") {
    return json({ queries: permissions.queriesFor(decodeURIComponent(parts[1])) });
  }

  if (parts[0] === "households" && parts[1] && parts[2] === "permissions") {
    const household = parts[1];
    if (method === "GET" && parts.length === 3) {
      // Clause 40. Always visible, revoked rows included.
      return json({ permissions: permissions.forHousehold(household) });
    }
    if (method === "POST" && parts.length === 3) {
      const raw = strict(
        await body(request),
        ["grantee", "scope", "purpose", "expires_at", "asked_from"],
        "permission"
      );
      const scope = raw.scope;
      if (!Array.isArray(scope) || scope.some((f) => typeof f !== "string")) {
        throw badRequest("malformed", "scope must be an array of field names");
      }
      return json(
        permissions.grant({
          household,
          grantee: requireString(raw, "grantee", "permission"),
          scope: scope as string[],
          purpose: requireString(raw, "purpose", "permission"),
          expires_at: requireInteger(raw, "expires_at", "permission", 0),
          asked_from: requireString(raw, "asked_from", "permission"),
        }),
        201
      );
    }
    if (method === "POST" && parts.length === 5 && parts[4] === "revoke") {
      // Clause 40. Each is revoked individually, and revoking appends.
      return json(permissions.revoke(household, parts[3]!));
    }
  }

  if (parts[0] === "households" && parts[1] && parts[2] === "export") {
    // Clause 43. Everything the household holds, whatever a surface shows.
    if (method === "GET") {
      return json(exportNode(engine, recovery, parts[1]));
    }
  }

  if (parts[0] === "households" && parts[1] && parts[2] === "import") {
    // Clause 52. The receiving host of a move.
    if (method === "POST") {
      const body_ = (await body(request)) as NodeExport;
      if (!body_ || body_.format !== "valence-node/1") {
        throw badRequest("malformed", "unknown export format");
      }
      const moving = decodeURIComponent(parts[1]);
      for (const offer of body_.offers ?? []) engine.importOffer(offer, moving);
      for (const s_ of body_.settlements ?? []) engine.importSettlement(s_);
      for (const n of body_.notes ?? []) engine.importNote(n);
      for (const e of body_.lineage ?? []) engine.importEdge(e, moving);
      engine.importReceipts(parts[1], body_.receipts ?? []);
      return json({ imported: true }, 201);
    }
  }

  if (parts[0] === "households" && parts[1] && parts[2] === "recoveries") {
    // Clause 53. The log a person reads after being locked out.
    if (method === "GET") {
      return json({ recoveries: recovery.logFor(parts[1]) });
    }
    if (method === "POST") {
      const raw = strict(await body(request), ["by"], "recovery");
      try {
        return json(
          recovery.recover({
            household: parts[1],
            by: requireString(raw, "by", "recovery"),
          }),
          201
        );
      } catch (err) {
        throw conflict("recovery_refused", (err as Error).message);
      }
    }
  }

  if (
    parts[0] === "households" &&
    parts[2] === "receipts" &&
    method === "GET" &&
    parts[1]
  ) {
    // §7.5. The fact of receipt, and nothing else.
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

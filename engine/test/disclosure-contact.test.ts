import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import {
  CONFIG_VERSION,
  HOUSEHOLD,
  MANDATE,
  MERCHANT_PAIR,
  disclosureFor,
  makeEngine,
} from "./helpers.js";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { renderStatement } from "../src/hub/statement.js";
import { canonicalDisclosure, verifyDisclosure, type DisclosureContact } from "../src/shared/disclosure.js";

type OfferView = {
  disclosures: { product: string | null; contact?: DisclosureContact }[];
};

/**
 * Question 72, decided 2026-09-22. The hub shows the merchant's contact
 * beside its return terms. Nothing here sends anything to the merchant: the
 * contact is rendered verbatim, exactly like every other field of a block a
 * merchant signed.
 */
describe("§10a, question 72: canonical form", () => {
  test("absent contact is byte-identical to a disclosure with no contact field at all", () => {
    const withoutField = { merchant: "maker-a", product: null, version: "d-1", items: [] };
    const withNullContact = { ...withoutField, contact: null };
    expect(canonicalDisclosure(withNullContact)).toEqual(canonicalDisclosure(withoutField));
  });

  test("a present contact changes the bytes", () => {
    const base = { merchant: "maker-a", product: null, version: "d-1", items: [] };
    const withContact = { ...base, contact: { kind: "email" as const, value: "support@maker-a.example" } };
    expect(canonicalDisclosure(withContact)).not.toEqual(canonicalDisclosure({ ...base, contact: null }));
  });

  test("the signature covers the contact: verifying and tampering", () => {
    const contact = { kind: "email" as const, value: "support@maker-a.example" };
    const signed = disclosureFor("maker-a", null, contact);
    expect(verifyDisclosure(signed, MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString())).toBe(
      true
    );
    const tampered = { ...signed, contact: { kind: "email" as const, value: "someone-else@maker-a.example" } };
    expect(
      verifyDisclosure(tampered, MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString())
    ).toBe(false);
  });
});

function hub() {
  return {
    deliveries: new DeliveryRegister(),
    approvals: new ApprovalDesk(),
    recovery: new RecoveryRegister(),
    permissions: new PermissionLedger(),
    registry: new Registry(),
  };
}

describe("§10a, question 72: registration is validated", () => {
  async function post(body: unknown) {
    const { engine } = makeEngine();
    const handle = createApp(engine, hub());
    return handle(
      new Request("https://unit.example/_disclosures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  function registered(contact: unknown) {
    const body = { merchant: "maker-a", product: null, version: "d-1", items: [], contact };
    return { ...body, signature: sign(null, canonicalDisclosure(body as never), MERCHANT_PAIR.privateKey).toString("base64") };
  }

  test("a well-formed contact of each kind is accepted", async () => {
    for (const contact of [
      { kind: "email", value: "support@maker-a.example" },
      { kind: "tel", value: "+1 (555) 123-4567" },
      { kind: "url", value: "https://maker-a.example/support" },
    ]) {
      const r = await post(registered(contact));
      expect(r.status).toBe(201);
    }
  });

  test("null and absent are both accepted as no contact", async () => {
    expect((await post(registered(null))).status).toBe(201);
    const { merchant, product, version, items } = registered(null);
    const withoutField = { merchant, product, version, items };
    const signature = sign(
      null,
      canonicalDisclosure(withoutField as never),
      MERCHANT_PAIR.privateKey
    ).toString("base64");
    expect((await post({ ...withoutField, signature })).status).toBe(201);
  });

  test("an unknown kind is refused, even where the value alone would pass as a url", async () => {
    // The value is a well-formed https url on purpose: a kind check that
    // fell through to the url branch instead of refusing outright would
    // accept this, so a mutation that drops the enum check and leaves the
    // per-kind branches in place is still caught.
    const r = await post(registered({ kind: "fax", value: "https://maker-a.example/support" }));
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("malformed");
  });

  test("an unknown field inside contact is refused", async () => {
    const r = await post(registered({ kind: "email", value: "support@maker-a.example", label: "support" }));
    expect(r.status).toBe(400);
  });

  test("a value over 256 characters is refused", async () => {
    const r = await post(registered({ kind: "url", value: `https://maker-a.example/${"a".repeat(260)}` }));
    expect(r.status).toBe(400);
  });

  test("an email with no @, more than one @, or whitespace is refused", async () => {
    for (const value of ["not-an-email", "a@b@c.example", "a b@c.example"]) {
      const r = await post(registered({ kind: "email", value }));
      expect(r.status).toBe(400);
    }
  });

  test("a tel with letters is refused", async () => {
    const r = await post(registered({ kind: "tel", value: "call-us-now" }));
    expect(r.status).toBe(400);
  });

  test("a url that does not parse, or is not https, is refused", async () => {
    for (const value of ["not a url", "http://maker-a.example/support"]) {
      const r = await post(registered({ kind: "url", value }));
      expect(r.status).toBe(400);
    }
  });
});

describe("§10a, question 72: a registered contact reaches every screen", () => {
  const CONTACT = { kind: "email" as const, value: "support@maker-a.example" };

  async function offerWithContact() {
    const made = makeEngine();
    const { engine } = made;
    // Replace the standing block `makeEngine` already registered with one
    // that also carries a contact.
    engine.putDisclosure(disclosureFor("maker-a", null, CONTACT));
    const offer = await engine.createOffer({
      binding: "digital",
      household: HOUSEHOLD,
      purpose: "replenish",
      config_version: CONFIG_VERSION,
      expires_at: Date.now() + 3_600_000,
      mandate: MANDATE,
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-a", quantity: 1, is_exploration: true }],
    } as never);
    await engine.present(offer.id);
    return { ...made, offer };
  }

  test("GET /offers/{id} carries the contact verbatim", async () => {
    const { engine, offer } = await offerWithContact();
    const handle = createApp(engine, hub());
    const r = await handle(new Request(`https://unit.example/offers/${offer.id}`));
    expect(r.status).toBe(200);
    const body = (await r.json()) as OfferView;
    const block = body.disclosures.find((d) => d.product === null)!;
    expect(block.contact).toEqual(CONTACT);
  });

  test("the approval carries the contact verbatim", async () => {
    const { engine, offer } = await offerWithContact();
    const desk = new ApprovalDesk();
    desk.record({
      offer: offer.id,
      perCandidate: { [offer.candidates[0]!.id]: { alternatives: ["tea-b"], argument_against: "less tea" } },
      excluded: [],
      mandate: { kind: "individual", scope: "once", lapses_at: null },
    });
    const rendered = desk.render(engine, offer, undefined);
    if ("missing" in rendered) throw new Error(rendered.missing);
    const block = rendered.disclosures.find((d) => d.product === null)!;
    expect(block.contact).toEqual(CONTACT);
  });

  test("a disclosure with no contact carries no contact key on any screen, so an older client reads it unchanged", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await engine.createOffer({
      binding: "digital",
      household: HOUSEHOLD,
      purpose: "replenish",
      config_version: CONFIG_VERSION,
      expires_at: Date.now() + 3_600_000,
      mandate: MANDATE,
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-a", quantity: 1, is_exploration: true }],
    } as never);
    await engine.present(offer.id);
    const handle = createApp(engine, hub());
    const r = await handle(new Request(`https://unit.example/offers/${offer.id}`));
    const body = (await r.json()) as OfferView;
    // NOTE (mutation check, 2026-09-22): contact_rendered_as_null. The iOS and
    // Android clients compare a block's keys exactly, so `contact: null`
    // failed every offer read on a client from before question 72.
    const block = body.disclosures.find((d) => d.product === null)!;
    expect(Object.keys(block).sort()).toEqual(["items", "merchant", "product", "signature", "version"]);

    const desk = new ApprovalDesk();
    desk.record({
      offer: offer.id,
      perCandidate: { [offer.candidates[0]!.id]: { alternatives: ["tea-b"], argument_against: "less tea" } },
      excluded: [],
      mandate: { kind: "individual", scope: "once", lapses_at: null },
    });
    const rendered = desk.render(engine, offer, undefined);
    if ("missing" in rendered) throw new Error(rendered.missing);
    expect("contact" in rendered.disclosures.find((d) => d.product === null)!).toBe(false);

    const statement = renderStatement(offer, undefined, engine.recoveries.for(offer.id));
    expect("contact" in statement.disclosures.find((d) => d.product === null)!).toBe(false);
  });
});

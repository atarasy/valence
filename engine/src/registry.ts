import { createPublicKey, verify } from "node:crypto";
import { badRequest, conflict, notFound, unprocessable } from "./errors.js";

/**
 * The endpoint registry. §16.
 *
 * A shared, neutral directory that resolves a merchant's key to its endpoints
 * and does nothing else. The line it must not cross is ranking: a registry
 * whose answer depends on anything but the question has become the place
 * where things are found, which clause 1 keeps the infrastructure from being.
 *
 * Every structural choice below follows from that. Entries have no rank field
 * because one cannot be added later without a schema change. Lists come back
 * in key order because key order says nothing. There is no free-text query
 * because the moment a registry answers "tea for a gift" it is deciding what a
 * person sees.
 */
export type Protocol = "valence" | "acp" | "ucp" | "ap2" | "mcp";

export const PROTOCOLS: readonly Protocol[] = ["valence", "acp", "ucp", "ap2", "mcp"];

export type Entry = {
  merchant: string;
  endpoints: Partial<Record<Protocol, string>>;
  /** Recorded, never required. Clause 64: the mark is not a gate. */
  mark: boolean;
  signature: string;
  registered_at: number;
};

/** The bytes a merchant signs. Fixed order, so the signature does not depend on the client. */
export function canonicalEntry(entry: {
  merchant: string;
  endpoints: Partial<Record<Protocol, string>>;
  mark: boolean;
}): Buffer {
  const parts = [
    entry.merchant,
    ...PROTOCOLS.map((p) => `${p}=${entry.endpoints[p] ?? ""}`),
    entry.mark ? "mark" : "nomark",
  ];
  return Buffer.from(parts.map(encodeURIComponent).join("\n"), "utf8");
}

export class Registry {
  private readonly entries = new Map<string, Entry>();
  private readonly keys = new Map<string, string>();

  attest(merchant: string, publicKeyPem: string): void {
    // A key, once attested, is not replaced by a later caller: whoever could
    // overwrite it could sign entries as the merchant (§16.1).
    const existing = this.keys.get(merchant);
    if (existing !== undefined && existing !== publicKeyPem) {
      throw conflict("identity_exists", `a key is already attested for ${merchant}`);
    }
    this.keys.set(merchant, publicKeyPem);
  }

  register(input: {
    merchant: string;
    endpoints: Partial<Record<Protocol, string>>;
    mark: boolean;
    signature: string;
    now?: number;
  }): Entry {
    const pem = this.keys.get(input.merchant);
    if (!pem) throw unprocessable("unattested_key", `key ${input.merchant} is not attested`);

    let ok = false;
    try {
      ok = verify(
        null,
        canonicalEntry(input),
        createPublicKey(pem),
        Buffer.from(input.signature, "base64")
      );
    } catch {
      ok = false;
    }
    if (!ok) throw unprocessable("bad_signature", "signature does not verify");

    if (Object.keys(input.endpoints).length === 0) {
      throw badRequest("malformed", "an entry names at least one endpoint");
    }
    for (const [proto, url] of Object.entries(input.endpoints)) {
      if (!PROTOCOLS.includes(proto as Protocol)) {
        throw badRequest("malformed", `unknown protocol ${proto}`);
      }
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        throw badRequest("malformed", `${proto} endpoint must be a URL`);
      }
    }

    if (this.entries.has(input.merchant)) {
      throw conflict("already_registered", "re-register by withdrawing first");
    }
    const entry: Entry = {
      merchant: input.merchant,
      endpoints: { ...input.endpoints },
      mark: input.mark,
      signature: input.signature,
      registered_at: input.now ?? Date.now(),
    };
    this.entries.set(input.merchant, entry);
    return entry;
  }

  resolve(merchant: string): Entry {
    const entry = this.entries.get(merchant);
    if (!entry) throw notFound(`no entry for ${merchant}`);
    return entry;
  }

  /**
   * Every entry speaking a protocol, in key order.
   *
   * Key order is the only order because it is the only one that says nothing.
   * There is no parameter for another, and the mark is not a filter unless
   * the caller asks for it by name (clause 64).
   */
  list(input: { protocol?: Protocol; markOnly?: boolean } = {}): Entry[] {
    return [...this.entries.values()]
      .filter((e) => !input.protocol || e.endpoints[input.protocol] !== undefined)
      .filter((e) => !input.markOnly || e.mark)
      .sort((a, b) => (a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0));
  }
}

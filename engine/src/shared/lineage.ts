import { verifyBy } from "./decisions.js";
import type { LineageKind } from "../common/types.js";

export type EdgeInput = {
  from: string;
  to: string;
  product: string;
  merchant: string;
  /**
   * Clause 12: every lineage edge names who made it. Added 2026-09-12, when
   * `merchant` stopped standing in for the maker. **Adding it to the bytes
   * invalidates every signature made over the old form**, which costs nothing
   * here and would cost a deployment its edges; §7.1 says so.
   */
  maker: string;
  kind: LineageKind;
  occasion: string;
  receipt: string;
};

/**
 * The bytes a giver signs. Field order is fixed here rather than taken from
 * the request, so two clients that serialise their JSON differently produce
 * the same signature over the same edge. §7.1 turns on the signature alone,
 * and a signature that depended on a client's formatting would discriminate
 * on client software by accident.
 */
export function canonical(edge: EdgeInput): Buffer {
  const parts = [
    edge.from,
    edge.to,
    edge.product,
    edge.merchant,
    edge.maker,
    edge.kind,
    edge.occasion,
    edge.receipt,
  ];
  return Buffer.from(parts.map(encodeURIComponent).join("\n"), "utf8");
}

export function verifyEdge(
  edge: EdgeInput & { signature: string },
  publicKeyPem: string
): boolean {
  return verifyBy(publicKeyPem, canonical(edge), Buffer.from(edge.signature, "base64"));
}

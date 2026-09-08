import { badRequest } from "./errors.js";

/**
 * Rejects any field the specification does not define.
 *
 * This is the mechanism behind §3.3 and clauses 27 to 30. A discount, a
 * countdown, a scarcity indicator, a rating or a per-person tracking id cannot
 * be smuggled in as an extra property and stored, because an unknown property
 * is a 400 before anything is written. Silently dropping unknown fields would
 * be the ordinary choice and would be wrong here: a caller that believes it
 * sent a discount and got a 200 has been told the field exists.
 */
export function strict(
  body: unknown,
  allowed: readonly string[],
  where: string
): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("malformed", `${where}: expected an object`);
  }
  const record = body as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw badRequest(
      "unknown_field",
      `${where}: no such field: ${unknown.sort().join(", ")}`
    );
  }
  return record;
}

export function requireString(
  record: Record<string, unknown>,
  key: string,
  where: string
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest("malformed", `${where}: ${key} must be a non-empty string`);
  }
  return value;
}

export function requireInteger(
  record: Record<string, unknown>,
  key: string,
  where: string,
  min: number
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw badRequest(
      "malformed",
      `${where}: ${key} must be an integer of at least ${min}`
    );
  }
  return value;
}

export function requireEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  where: string,
  values: readonly T[]
): T {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw badRequest(
      "malformed",
      `${where}: ${key} must be one of ${values.join(", ")}`
    );
  }
  return value as T;
}

export function optionalUnitInterval(
  record: Record<string, unknown>,
  key: string,
  where: string
): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw badRequest("malformed", `${where}: ${key} must be between 0 and 1`);
  }
  return value;
}

export function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  where: string
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw badRequest("malformed", `${where}: ${key} must be a boolean`);
  }
  return value;
}

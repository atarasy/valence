import { randomUUID } from 'node:crypto';
import { canonicalMandate, loosens, MAX_COOLING_SECONDS, MAX_LAPSE_MS, type Mandate } from '../../engine/src/hub/mandates.ts';
import { challengeForBytes, verifyPersonal, type Assertion } from '../../engine/src/shared/decisions.ts';
import { householdOfMandate, isHouseholdName } from '../../engine/src/common/names.ts';
import { records } from './records.ts';
import type { memberRuntime } from './runtime.ts';
import { badRequest, conflict, notFound, unprocessable } from '../../engine/src/common/errors.ts';

type ChangeState = 'pending' | 'effective' | 'cancelled' | 'stale';
type StoredChange = {
  id: string;
  before: Mandate;
  mandate: Mandate;
  requiredSigners: string[];
  assertions: Record<string, Assertion>;
  state: ChangeState;
  createdAt: number;
  updatedAt: number;
};

function equalMandate(a: Mandate, b: Mandate): boolean {
  return canonicalMandate(a, 'comparison.invalid').equals(canonicalMandate(b, 'comparison.invalid'));
}

/**
 * IOS-B17 / §16.1. A durable member-facing ceremony for changing an effective
 * mandate. The proposed version is fixed before anybody signs it. A loosening
 * collects the household and every co-signer named by the previous effective
 * version; a tightening collects the household alone.
 */
export function openMandateChanges(r: ReturnType<typeof memberRuntime>, policy: { rpID: string }) {
  const rows = records<StoredChange>(r.path, 'member_mandate_changes');
  const now = r.now;

  function session(token: string) {
    const value = r.authority.sessionPrincipal(token);
    if (!value) throw notFound('Mandate change unavailable');
    return value;
  }

  function currentState(row: StoredChange): StoredChange {
    if (row.state !== 'pending') return row;
    const effective = r.engine.mandates.get(row.mandate.id);
    if (!effective || !equalMandate(effective, row.before)) {
      const stale = { ...row, state: 'stale' as const, updatedAt: now() };
      rows.put(row.id, stale);
      return stale;
    }
    return row;
  }

  function visible(row: StoredChange, household: string): boolean {
    return row.mandate.household === household || row.requiredSigners.includes(household);
  }

  function projection(input: StoredChange) {
    const row = currentState(input);
    return {
      id: row.id,
      before: row.before,
      mandate: row.mandate,
      requiredSigners: row.requiredSigners,
      signedBy: row.requiredSigners.filter((key) => row.assertions[key] !== undefined),
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function checkedDraft(value: Mandate, household: string): { before: Mandate; required: string[] } {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.household !== 'string') throw badRequest('invalid_mandate', 'Invalid mandate change');
    const before = r.engine.mandates.get(value.id);
    if (!before || before.household !== household || value.household !== household || householdOfMandate(value.id) !== household) throw notFound('Mandate change unavailable');
    if (value.version !== before.version + 1 || !Number.isSafeInteger(value.version) || value.version >= Number.MAX_SAFE_INTEGER) throw conflict('stale_version', 'The effective mandate version changed');
    if (!Number.isSafeInteger(value.lapses_at) || value.lapses_at <= now() || value.lapses_at > now() + MAX_LAPSE_MS) throw unprocessable('invalid_lapse', 'Invalid mandate lapse');
    for (const amount of [value.ceiling_out_of_network, value.ceiling_daily, value.cooling_seconds]) {
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw unprocessable('invalid_protection', 'Invalid mandate protection');
    }
    if (value.cooling_seconds !== null && value.cooling_seconds > MAX_COOLING_SECONDS) throw unprocessable('invalid_cooling', 'Invalid mandate cooling');
    if (!Array.isArray(value.co_signers) || new Set(value.co_signers).size !== value.co_signers.length || value.co_signers.some((key) => !isHouseholdName(key))) throw unprocessable('invalid_co_signers', 'Invalid mandate co-signers');
    if (value.ceiling_out_of_network === before.ceiling_out_of_network && value.ceiling_daily === before.ceiling_daily && value.cooling_seconds === before.cooling_seconds && value.lapses_at === before.lapses_at && JSON.stringify([...value.co_signers].sort()) === JSON.stringify([...before.co_signers].sort())) throw unprocessable('no_change', 'A new version changes or renews a protection');
    canonicalMandate(value, policy.rpID);
    const required = [household, ...(loosens(before, value) ? before.co_signers : [])];
    return { before, required: [...new Set(required)].sort() };
  }

  function find(id: string): StoredChange {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw badRequest('invalid_change', 'Invalid mandate change identifier');
    const row = rows.get(id);
    if (!row) throw notFound('Mandate change unavailable');
    return currentState(row);
  }

  return {
    effective(token: string) {
      const who = session(token);
      return { mandates: r.engine.mandates.forHousehold(who.household).sort((a, b) => a.id.localeCompare(b.id)) };
    },
    list(token: string) {
      const who = session(token), changes: ReturnType<typeof projection>[] = [];
      rows.each((row) => { if (visible(row, who.household)) changes.push(projection(row)); });
      changes.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return { changes: changes.slice(0, 100) };
    },
    read(token: string, id: string) {
      const who = session(token), row = find(id);
      if (!visible(row, who.household)) throw new Error('Mandate change unavailable');
      return projection(row);
    },
    prepare(token: string, mandate: Mandate) {
      const who = session(token), checked = checkedDraft(mandate, who.household);
      const matching: StoredChange[] = [];
      rows.each((candidate) => {
        const row = currentState(candidate);
        if (row.state === 'pending' && row.mandate.id === mandate.id) matching.push(row);
      });
      const existing = matching[0];
      if (existing) {
        if (!equalMandate(existing.mandate, mandate)) throw conflict('change_pending', 'A mandate change is already pending');
        return { ...projection(existing), publicKey: options(who.principal, mandate) };
      }
      const at = now(), row: StoredChange = { id: randomUUID(), before: checked.before, mandate: structuredClone(mandate), requiredSigners: checked.required, assertions: {}, state: 'pending', createdAt: at, updatedAt: at };
      rows.insert(row.id, row);
      return { ...projection(row), publicKey: options(who.principal, mandate) };
    },
    prepareSignature(token: string, id: string) {
      const who = session(token), row = find(id);
      if (row.state !== 'pending' || !row.requiredSigners.includes(who.household)) throw notFound('Mandate change unavailable');
      return { ...projection(row), publicKey: options(who.principal, row.mandate) };
    },
    submit(token: string, id: string, assertion: Assertion) {
      const who = session(token), row = find(id);
      if (row.state === 'effective' && row.assertions[who.household] !== undefined) return projection(row);
      if (row.state !== 'pending' || !row.requiredSigners.includes(who.household)) throw notFound('Mandate change unavailable');
      if (row.assertions[who.household] === undefined) {
        const pem = r.engine.publicKeyFor(who.household);
        if (!pem || !verifyPersonal(canonicalMandate(row.mandate, policy.rpID), { assertion }, pem, policy.rpID)) throw unprocessable('bad_signature', 'Invalid mandate signature');
        row.assertions[who.household] = structuredClone(assertion);
        row.updatedAt = now();
      }
      if (row.requiredSigners.every((key) => row.assertions[key] !== undefined)) {
        r.engine.mandates.record({ mandate: row.mandate, signatures: {}, assertions: row.assertions, keyOf: (key) => r.engine.publicKeyFor(key), relyingPartyId: policy.rpID, now: now() });
        row.state = 'effective'; row.updatedAt = now();
      }
      rows.put(row.id, row);
      return projection(row);
    },
    cancel(token: string, id: string) {
      const who = session(token), row = find(id);
      if (row.mandate.household !== who.household || row.state !== 'pending') throw notFound('Mandate change unavailable');
      row.state = 'cancelled'; row.updatedAt = now(); rows.put(row.id, row);
      return projection(row);
    },
  };

  function options(principal: string, mandate: Mandate) {
    return {
      challenge: challengeForBytes(canonicalMandate(mandate, policy.rpID)),
      rpId: policy.rpID,
      userVerification: 'required' as const,
      allowCredentials: r.authority.activeCredentialIDs(principal).map((id) => ({ type: 'public-key' as const, id })),
    };
  }
}

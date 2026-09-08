import { randomUUID } from "node:crypto";
import { badRequest, conflict, notFound, unprocessable } from "./errors.js";

/**
 * The permission ledger.
 *
 * Clauses 37 to 42. A list of exceptions to "nobody but me", not a list that
 * includes me: the default recipient of data is the person's own agent, and
 * that is not a permission (42). If the person appeared in this ledger their
 * own entry could be revoked, and the hub would stop working.
 *
 * Six things are structural here rather than checked, because a rule that can
 * be turned off in configuration is not one of these clauses.
 */
export type Permission = {
  id: string;
  /** Who may read. Never the household itself. */
  grantee: string;
  /** What, narrowly. A field set, not a category. */
  scope: string[];
  /** Why, in the words the person was shown when asked. */
  purpose: string;
  granted_at: number;
  /**
   * When it lapses. There is no value meaning "never".
   *
   * Clause 37 requires permissions to be time-limited. If an empty field meant
   * unlimited, blanket consent would return in the shape of a null, which is
   * the thing the clause exists to remove.
   */
  expires_at: number;
  /**
   * The action that needed this permission, which must be live.
   *
   * This is how "asked at the moment of use" becomes checkable. A settings
   * screen has no action to point at, so there is no way to grant from one.
   */
  asked_from: string;
  /** Revoking appends. A row that disappears makes clause 40 false about the past. */
  revoked_at: number | null;
};

/**
 * §4.2 of the hub surfaces. Who asked what, kept in the recipient's own
 * record. A duplicate check is one bit at a time, and one bit at a time is
 * still a read of the list, so the reads are visible to the person whose
 * list it is.
 */
export type Query = {
  id: string;
  asked_by: string;
  product: string;
  answered: boolean;
  at: number;
};

export type PendingAction = {
  id: string;
  household: string;
  /** What the action is, in the words the person sees. */
  describes: string;
  expires_at: number;
};

export class PermissionLedger {
  private readonly rows = new Map<string, Permission[]>();
  private readonly actions = new Map<string, PendingAction>();
  private readonly queries = new Map<string, Query[]>();

  /**
   * Opens an action that a permission can be asked for. Deployment plumbing:
   * the specification describes the ledger, not how a hub decides it needs one.
   */
  openAction(input: {
    household: string;
    describes: string;
    expiresAt: number;
  }): PendingAction {
    const action: PendingAction = {
      id: randomUUID(),
      household: input.household,
      describes: input.describes,
      expires_at: input.expiresAt,
    };
    this.actions.set(action.id, action);
    return action;
  }

  grant(input: {
    household: string;
    grantee: string;
    scope: string[];
    purpose: string;
    expires_at: number;
    asked_from: string;
    now?: number;
  }): Permission {
    const now = input.now ?? Date.now();

    if (input.grantee === input.household) {
      // Clause 38. The person's own agent is the default recipient, not a
      // grantee, and an entry for it would be revocable.
      throw unprocessable(
        "own_agent",
        "the household's own agent is the default recipient, not a grantee"
      );
    }

    const action = this.actions.get(input.asked_from);
    if (!action) {
      throw unprocessable(
        "no_live_action",
        "a permission is asked for at the moment of use, and this names no action"
      );
    }
    if (action.household !== input.household) {
      throw unprocessable("no_live_action", "that action belongs to another household");
    }
    if (action.expires_at <= now) {
      throw unprocessable("stale_action", "that action is no longer live");
    }

    if (!Number.isFinite(input.expires_at) || input.expires_at <= now) {
      throw unprocessable(
        "not_time_limited",
        "expires_at must be in the future. There is no value meaning never"
      );
    }
    if (input.scope.length === 0) {
      throw badRequest("malformed", "scope must name at least one field");
    }

    const permission: Permission = {
      id: randomUUID(),
      grantee: input.grantee,
      scope: [...input.scope],
      purpose: input.purpose,
      granted_at: now,
      expires_at: input.expires_at,
      asked_from: input.asked_from,
      revoked_at: null,
    };
    const list = this.rows.get(input.household) ?? [];
    list.push(permission);
    this.rows.set(input.household, list);
    return permission;
  }

  /** Clause 40. Revoking appends; nothing leaves the list. */
  revoke(household: string, id: string, now = Date.now()): Permission {
    const list = this.rows.get(household) ?? [];
    const permission = list.find((p) => p.id === id);
    if (!permission) throw notFound(`no permission ${id}`);
    if (permission.revoked_at !== null) {
      throw conflict("already_revoked", "that permission is already revoked");
    }
    permission.revoked_at = now;
    return permission;
  }

  /**
   * The whole list, revoked rows included (clause 40).
   *
   * `asked_from` is here because this is the household's own view. It is not
   * on any grantee's view, where it would report what the household was doing
   * when it was asked.
   */
  forHousehold(household: string): Permission[] {
    return this.rows.get(household) ?? [];
  }

  /**
   * Whether a grantee may read a field right now.
   *
   * Expiry is evaluated here rather than swept, so that a permission which has
   * lapsed stops working at the moment it lapses rather than at the next sweep.
   */
  /**
   * §4.2. A duplicate check runs against a live action, under a grant this
   * household gave this giver for this use, and it leaves a row in the
   * household's own record. It answers one bit and enumerates nothing.
   */
  recordQuery(input: {
    household: string;
    asked_by: string;
    product: string;
    asked_from: string;
    answered: boolean;
    now?: number;
  }): Query {
    const now = input.now ?? Date.now();
    const action = this.actions.get(input.asked_from);
    if (!action || action.household !== input.household) {
      throw unprocessable(
        "no_live_action",
        "a duplicate check is asked at the moment of use, and this names no action of this household"
      );
    }
    if (action.expires_at <= now) {
      throw unprocessable("stale_action", "that action is no longer live");
    }
    const row: Query = {
      id: randomUUID(),
      asked_by: input.asked_by,
      product: input.product,
      answered: input.answered,
      at: now,
    };
    const list = this.queries.get(input.household) ?? [];
    list.push(row);
    this.queries.set(input.household, list);
    return row;
  }

  queriesFor(household: string): Query[] {
    return [...(this.queries.get(household) ?? [])];
  }

  allows(input: {
    household: string;
    grantee: string;
    field: string;
    now?: number;
  }): boolean {
    const now = input.now ?? Date.now();
    return (this.rows.get(input.household) ?? []).some(
      (p) =>
        p.grantee === input.grantee &&
        p.revoked_at === null &&
        p.expires_at > now &&
        p.scope.includes(input.field)
    );
  }
}

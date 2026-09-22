export class ValenceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Fields the refusal carries beside its message, such as what blocked it. */
    readonly detail?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ValenceError";
  }
}

export const badRequest = (code: string, message: string) =>
  new ValenceError(400, code, message);

export const notFound = (message: string) =>
  new ValenceError(404, "not_found", message);

/**
 * §13.1. Not "there is nothing here" but "this party does not answer for that
 * surface". It is a 404 because from the caller's side the route is not on
 * this deployment, and it carries its own code because a caller that cannot
 * tell it from an ordinary miss will retry against the same party forever.
 * The same discipline as §16.6: a refusal names itself.
 */
export const notThisRole = (message: string) =>
  new ValenceError(404, "not_this_role", message);

/**
 * §16.3, question 67. A report only the engine may make, from a caller that
 * did not prove it is the engine. The two routes the engine reports to the
 * person's copy through took any row from any caller, so a stranger could
 * empty a household's day or fill it past every settlement.
 */
export const unauthenticatedReport = (message: string) =>
  new ValenceError(401, "unauthenticated_report", message);

export const conflict = (code: string, message: string, detail?: Record<string, unknown>) =>
  new ValenceError(409, code, message, detail);

/**
 * 422 is the specification's own status for the exploration floor (§5) and is
 * reused for every other refusal that is about the content of a well-formed
 * request rather than its shape.
 */
export const unprocessable = (code: string, message: string) =>
  new ValenceError(422, code, message);

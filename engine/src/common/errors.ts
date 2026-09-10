export class ValenceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
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

export const conflict = (code: string, message: string) =>
  new ValenceError(409, code, message);

/**
 * 422 is the specification's own status for the exploration floor (§5) and is
 * reused for every other refusal that is about the content of a well-formed
 * request rather than its shape.
 */
export const unprocessable = (code: string, message: string) =>
  new ValenceError(422, code, message);

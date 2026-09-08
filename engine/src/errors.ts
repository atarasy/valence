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

export const conflict = (code: string, message: string) =>
  new ValenceError(409, code, message);

/**
 * 422 is the specification's own status for the exploration floor (§5) and is
 * reused for every other refusal that is about the content of a well-formed
 * request rather than its shape.
 */
export const unprocessable = (code: string, message: string) =>
  new ValenceError(422, code, message);

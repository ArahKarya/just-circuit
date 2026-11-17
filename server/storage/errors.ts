export class NotFoundError extends Error {}

/** The request conflicts with what is stored (e.g. a folder that is not empty). */
export class ConflictError extends Error {}

/** The input is well-formed but not acceptable (wrong file type, too big…). */
export class ValidationError extends Error {}

/** An outside service (part catalog, footprint cache) failed or answered with an error status: not a Just Circuit bug. */
export class ExternalServiceError extends Error {
  override name = "ExternalServiceError"
}

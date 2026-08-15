/**
 * Typed application errors.
 *
 * Server Actions return these as values rather than throwing where the UI needs
 * to render a message; genuinely exceptional cases throw and are caught by the
 * nearest error boundary.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function forbidden(message = 'You do not have permission to do that.'): never {
  throw new AppError(message, 'forbidden', 403)
}

export function notAuthorized(message = 'Please sign in to continue.'): never {
  throw new AppError(message, 'unauthorized', 401)
}

export function badRequest(message: string): never {
  throw new AppError(message, 'bad_request', 400)
}

export function notFoundError(message = 'Not found.'): never {
  throw new AppError(message, 'not_found', 404)
}

/** Discriminated result used by every Server Action. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string }

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function fail(error: string, field?: string): ActionResult<never> {
  return { ok: false, error, field }
}

/**
 * Wraps an action body so unexpected throws become a rendered message instead
 * of a blank screen. AppError messages are safe to show; anything else is
 * logged and replaced with a generic string so internals never leak.
 */
export async function guarded<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn())
  } catch (err) {
    if (err instanceof AppError) return fail(err.message)
    // Next uses thrown sentinels for redirect() and notFound(); those must
    // propagate rather than be swallowed as errors.
    if (err && typeof err === 'object' && 'digest' in err) throw err
    console.error('[action]', err)
    return fail('Something went wrong. Please try again.')
  }
}

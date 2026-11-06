import { LinearError, LinearErrorType } from "@linear/sdk";

// What a failed Linear call means is read from the structure of the error — the SDK's
// LinearError (its GraphQL errors, the type and HTTP status parseLinearError derived from
// them) and the fetch failure underneath it — never from the message text. Matching words
// like "network" or "timeout" in a message filed a 429 or a 503 as "Linear rejected this
// change", which rolled the change back and dropped it from the queue, and would have filed a
// validation error that happened to mention "network" as "offline, retry forever".

// The request never reached Linear: fetch failed at the network (offline, DNS, a refused or
// dropped connection, TLS). fetch reports that as a TypeError whose cause carries the system's
// error code (ENOTFOUND, ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT, ...), and the SDK wraps it with
// no HTTP status and no GraphQL errors. A request fetch refuses before sending anything — a
// header value it can't encode, from an API key pasted with a stray character — has no such
// cause. That isn't being offline, and calling it that would hide the real problem behind
// "no network" on every sync.
export function isLinearUnreachable(error: unknown): boolean {
  if (!(error instanceof LinearError) || error.status !== undefined || hasGraphQLErrors(error)) return false;
  const raw: unknown = error.raw;
  return raw instanceof Error && hasErrorCode((raw as { cause?: unknown }).cause);
}

// Linear answered, but not with a verdict on the change itself: it's rate limiting us, failing
// on its side, holding a lock, or not accepting the API key right now. Sending the same change
// again later can succeed without anything changing here, so it stays queued.
const RETRY_LATER_TYPES: ReadonlySet<LinearErrorType> = new Set([
  LinearErrorType.Ratelimited,
  LinearErrorType.InternalError,
  LinearErrorType.NetworkError,
  LinearErrorType.LockTimeout,
  LinearErrorType.AuthenticationError,
]);

// Whether a failed change should stay queued and be sent again, rather than be rolled back.
// Only Linear refusing the change itself — a GraphQL error of a type that isn't one of the
// passing ones above — rolls it back; anything less certain keeps what the user did.
export function shouldRetryLater(error: unknown): boolean {
  if (!(error instanceof LinearError)) return false;
  // No GraphQL error in the answer means nothing in it is Linear's verdict on the change:
  // there was no answer, or only an HTTP status — a 5xx, a 429, a captive portal's or a
  // firewall's page. The SDK still names a type from the status alone (a bare 403 becomes
  // Forbidden, any other bare 4xx AuthenticationError), so that type means nothing here.
  if (!hasGraphQLErrors(error)) return true;
  if (error.type !== undefined && RETRY_LATER_TYPES.has(error.type)) return true;
  // HTTP's own "try again later" statuses, whatever the body named — a GraphQL error type the
  // SDK doesn't recognise comes out as Unknown.
  return error.status === 429 || (error.status !== undefined && error.status >= 500);
}

function hasGraphQLErrors(error: LinearError): boolean {
  return (error.errors?.length ?? 0) > 0;
}

function hasErrorCode(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "string";
}

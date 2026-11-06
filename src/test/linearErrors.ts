import { LinearError, parseLinearError } from "@linear/sdk";

// The errors the extension actually receives from Linear, built the way they really come
// about: the SDK's own parseLinearError, given what a failed request hands it.

type RawLinearError = Parameters<typeof parseLinearError>[0];

export function linearError(raw: unknown): LinearError {
  return parseLinearError(raw as RawLinearError);
}

// What Node's fetch throws when the request never gets anywhere: a TypeError whose cause is
// the system error, with its code (probed: getaddrinfo ENOTFOUND, connect ECONNREFUSED).
export function networkFailure(code = "ENOTFOUND"): TypeError {
  const cause = Object.assign(new Error(`getaddrinfo ${code} api.linear.app`), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

export function offline(): LinearError {
  return linearError(networkFailure());
}

// What Node's fetch throws for a request it refuses to send: a header value it can't encode,
// such as an API key pasted with a full-width space. No cause.
export function refusedByFetch(): LinearError {
  return linearError(
    new TypeError(
      "Cannot convert argument to a ByteString because the character at index 9 has a value of 12288 which is greater than 255.",
    ),
  );
}

// An answer from Linear carrying a GraphQL error of the given extension type ("ratelimited",
// "invalid input", ...).
export function graphqlError(type: string, message = "Linear said no", status = 400): LinearError {
  return linearError({
    message: `${message}: {"response":{}}`,
    response: { status, errors: [{ message, extensions: { type } }] },
  });
}

// An HTTP answer with no GraphQL error in it: a 5xx page, a proxy's or captive portal's page.
export function bareHttpAnswer(status: number, body = "<html></html>"): LinearError {
  return linearError({ message: `GraphQL Error (Code: ${status})`, response: { status, error: body } });
}

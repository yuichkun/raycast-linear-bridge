import { describe, expect, it } from "vitest";
import {
  bareHttpAnswer,
  graphqlError,
  linearError,
  networkFailure,
  offline,
  refusedByFetch,
} from "../test/linearErrors";
import { isLinearUnreachable, shouldRetryLater } from "./linearErrors";

describe("isLinearUnreachable", () => {
  it("is true when fetch couldn't get the request to Linear", () => {
    expect(isLinearUnreachable(offline())).toBe(true);
    expect(isLinearUnreachable(linearError(networkFailure("ECONNREFUSED")))).toBe(true);
  });

  it("is false whenever Linear answered, however it answered", () => {
    expect(isLinearUnreachable(graphqlError("ratelimited"))).toBe(false);
    expect(isLinearUnreachable(graphqlError("invalid input"))).toBe(false);
    expect(isLinearUnreachable(bareHttpAnswer(503))).toBe(false);
  });

  // Saying "offline" here would hide the real problem — an API key with a stray character in
  // it — behind "no network" on every sync.
  it("is false for a request fetch refused to send, which isn't the network", () => {
    expect(isLinearUnreachable(refusedByFetch())).toBe(false);
  });

  it("is false for an error that didn't come from Linear, whatever its message says", () => {
    expect(isLinearUnreachable(new Error("fetch failed"))).toBe(false);
  });
});

describe("shouldRetryLater", () => {
  it("keeps a change Linear never saw", () => {
    expect(shouldRetryLater(offline())).toBe(true);
  });

  // The data-loss bug: none of these messages contains "network" or "timeout", so the
  // message matching this replaced filed them as "Linear rejected the change" and rolled
  // the change back.
  it("keeps a change Linear only declined to handle right now", () => {
    expect(shouldRetryLater(graphqlError("ratelimited", "Rate limit exceeded"))).toBe(true);
    expect(shouldRetryLater(bareHttpAnswer(429))).toBe(true);
    expect(shouldRetryLater(bareHttpAnswer(503, "<html>Service Unavailable</html>"))).toBe(true);
    expect(shouldRetryLater(graphqlError("internal error", "Internal error", 500))).toBe(true);
    expect(shouldRetryLater(graphqlError("lock timeout"))).toBe(true);
  });

  it("keeps changes when Linear doesn't accept the API key, rather than rolling every one back", () => {
    expect(shouldRetryLater(graphqlError("authentication error", "Authentication required"))).toBe(true);
  });

  it("goes by the HTTP status when the body names an error type the SDK doesn't know", () => {
    expect(shouldRetryLater(graphqlError("some new type", "x", 429))).toBe(true);
    expect(shouldRetryLater(graphqlError("some new type", "x", 502))).toBe(true);
    expect(shouldRetryLater(graphqlError("some new type", "x", 400))).toBe(false);
  });

  // The SDK types a bare 403 as Forbidden from the status alone — but with no GraphQL error
  // in it, it's a firewall's or proxy's answer, not Linear refusing the change. Rolling back
  // on it emptied the whole queue.
  it("keeps a change when the answer carries no GraphQL error, whatever its status", () => {
    expect(shouldRetryLater(bareHttpAnswer(403, "<html>Access denied</html>"))).toBe(true);
    expect(shouldRetryLater(bareHttpAnswer(404))).toBe(true);
    expect(shouldRetryLater(bareHttpAnswer(200, "<html>Log in to the Wi-Fi</html>"))).toBe(true);
  });

  it("keeps a change fetch refused to send, so fixing the API key lets it through", () => {
    expect(shouldRetryLater(refusedByFetch())).toBe(true);
  });

  it("lets a change Linear refused be rolled back", () => {
    expect(shouldRetryLater(graphqlError("invalid input", "Argument Validation Error"))).toBe(false);
    expect(shouldRetryLater(graphqlError("forbidden", "Forbidden", 403))).toBe(false);
    expect(shouldRetryLater(graphqlError("feature not accessible"))).toBe(false);
    expect(shouldRetryLater(graphqlError("graphql error"))).toBe(false);
  });

  // The other half of the message-matching bug: a refusal whose text happens to contain a
  // word like "network" must not be retried forever.
  it("lets a refusal be rolled back even when its message mentions the network", () => {
    expect(shouldRetryLater(graphqlError("invalid input", "Invalid network configuration"))).toBe(false);
  });

  it("doesn't treat an error from outside Linear as one to retry", () => {
    expect(shouldRetryLater(new Error("fetch failed"))).toBe(false);
  });
});

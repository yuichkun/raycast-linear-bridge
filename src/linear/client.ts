import { LinearClient } from "@linear/sdk";
import { getPreferenceValues } from "@raycast/api";
import { Preferences } from "../types";

let cachedClient: LinearClient | undefined;

export function getLinearClient(): LinearClient {
  if (!cachedClient) {
    const { linearApiKey } = getPreferenceValues<Preferences>();
    cachedClient = new LinearClient({ apiKey: linearApiKey });
  }
  return cachedClient;
}

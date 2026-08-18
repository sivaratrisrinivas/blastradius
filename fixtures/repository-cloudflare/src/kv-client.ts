export async function readLegacyValue(): Promise<Response> {
  return fetch("https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces/ns123/values/key");
}

export async function readCurrentValue(): Promise<Response> {
  return fetch("https://api.cloudflare.com/client/v4/accounts/abc123/storage/kv/namespaces/ns123/values/key");
}

export async function readDynamicValue(accountId: string, namespaceId: string): Promise<Response> {
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/namespaces/${namespaceId}/values/key`);
}

// A substring collision is not a legacy route.
export const decoy = "prefix/accounts/abc123/workers/namespaces/ns123/values/key-suffix";

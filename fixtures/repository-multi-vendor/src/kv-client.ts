export async function readLegacyValue(): Promise<Response> {
  return fetch("https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces/ns123/values/key");
}

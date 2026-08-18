// https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces/ns123
const replacement = "https://api.cloudflare.com/client/v4/accounts/abc123/storage/kv/namespaces/ns123";
const nearMiss = "https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces-old/ns123";
const substring = "prefix https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces/ns123 suffix";
const dynamicConcatenation = "https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces/ns123/values/key" + "?debug=true";

export function useDecoys() {
  return [replacement, nearMiss, substring, dynamicConcatenation];
}

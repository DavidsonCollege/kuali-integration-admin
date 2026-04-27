import { GraphQLClient } from 'graphql-request';

// Thin wrapper around graphql-request that pulls auth from useApiKey().
//
// Browser → /api/graphql (Nitro proxy in server/api/graphql.post.js)
//        → Kuali Build's GraphQL endpoint, server-to-server.
//
// We can't call Kuali Build directly from the browser because its API
// doesn't send CORS headers. The proxy avoids that by running server-side.
const GRAPHQL_PATH = '/app/api/v0/graphql';
const PROXY_PATH = '/api/graphql';

export const useGraphQL = () => {
  const { apiKey, baseUrl, clearApiKey, authError } = useApiKey();

  // The user-supplied Kuali URL. Accept either the bare host
  // (`https://tenant.kualibuild.com`) or the full GraphQL URL
  // (`https://tenant.kualibuild.com/app/api/v0/graphql`). Travels to the
  // proxy via X-Kuali-Endpoint header.
  const endpoint = computed(() => {
    const trimmed = (baseUrl.value || '').replace(/\/+$/, '');
    if (trimmed.endsWith(GRAPHQL_PATH)) return trimmed;
    return trimmed + GRAPHQL_PATH;
  });

  const request = async (query, variables = {}) => {
    if (!apiKey.value) {
      throw new Error('No API key configured. Connect on the home page first.');
    }
    // graphql-request validates the endpoint with `new URL(...)`, which throws
    // on a bare path. Use the page origin so the proxy URL is absolute.
    const proxyUrl = (typeof window !== 'undefined' ? window.location.origin : '') + PROXY_PATH;
    const client = new GraphQLClient(proxyUrl, {
      headers: {
        Authorization: `Bearer ${apiKey.value}`,
        'X-Kuali-Endpoint': endpoint.value,
      }
    });
    try {
      return await client.request(query, variables);
    } catch (e) {
      // Upstream 401 — token bad or expired. Clear it and stash a message
      // for the home page to show above the connect form. The proxy attaches
      // extensions.upstreamStatus on non-2xx responses so we don't have to
      // parse error strings to detect this.
      const upstreamStatus = e?.response?.errors?.[0]?.extensions?.upstreamStatus;
      if (upstreamStatus === 401) {
        authError.value = 'Your Kuali token expired or was rejected. Please reconnect.';
        clearApiKey();
        throw new Error(authError.value);
      }
      const msg = e?.message || String(e);
      if (msg === 'Failed to fetch' || /NetworkError|TypeError: Failed/.test(msg)) {
        throw new Error(
          `Network error reaching the local proxy at ${PROXY_PATH}. Is the dev server running?`
        );
      }
      throw e;
    }
  };

  return { request, endpoint };
};

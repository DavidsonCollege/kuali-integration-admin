// Server-side proxy to the Kuali Build GraphQL API.
//
// Why this exists: Kuali Build's GraphQL endpoint doesn't send CORS headers
// for browser origins, so a static SPA can't call it directly. This Nitro
// route runs server-to-server, sidesteps CORS, and forwards the request.
//
// The client (composables/useGraphQL.js) POSTs the GraphQL payload here and
// supplies two headers we forward upstream:
//   - Authorization        — the user's Kuali bearer token
//   - X-Kuali-Endpoint     — the full Kuali GraphQL URL (per-tenant)
//
// SSRF guard: the upstream URL must be https and end with `.kualibuild.com`.
//
// Error handling: every failure path returns a GraphQL-shaped
// `{ errors: [{ message }] }` body with HTTP 200, so graphql-request on the
// client surfaces a clean ClientError with our message instead of a generic
// "Network error".

const ALLOWED_HOST_SUFFIX = '.kualibuild.com';

const gqlError = (message, extensions) => ({
  errors: [extensions ? { message, extensions } : { message }],
});

export default defineEventHandler(async (event) => {
  const endpointHeader = getHeader(event, 'x-kuali-endpoint');
  if (!endpointHeader) {
    return gqlError('Proxy: missing X-Kuali-Endpoint header.');
  }

  let target;
  try {
    target = new URL(endpointHeader);
  } catch {
    return gqlError('Proxy: X-Kuali-Endpoint is not a valid URL.');
  }
  if (target.protocol !== 'https:') {
    return gqlError('Proxy: X-Kuali-Endpoint must use https.');
  }
  if (!target.host.endsWith(ALLOWED_HOST_SUFFIX)) {
    return gqlError(
      `Proxy: X-Kuali-Endpoint host must end in ${ALLOWED_HOST_SUFFIX} (got ${target.host}).`
    );
  }

  const auth = getHeader(event, 'authorization');
  if (!auth) {
    return gqlError('Proxy: missing Authorization header.');
  }

  const body = await readBody(event);

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return gqlError(
      `Proxy: failed to reach Kuali at ${target.toString()}: ${e?.message || e}`
    );
  }

  const text = await upstream.text();

  if (!upstream.ok) {
    return gqlError(
      `Kuali returned HTTP ${upstream.status} ${upstream.statusText || ''}: ${
        text || '(empty body)'
      }`.trim(),
      { upstreamStatus: upstream.status }
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return gqlError(`Kuali returned non-JSON response: ${text.slice(0, 500)}`);
  }
});

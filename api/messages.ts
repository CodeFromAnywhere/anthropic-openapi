export const OPTIONS = async (request: Request) => {
  // Set CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  // Handle OPTIONS request (preflight)
  return new Response(null, { headers });
};
/**
 * Proxy: Pass the request, allowing any origin
 *
 * Instead, we can use a header too. https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/
 */

export const POST = async (request: Request) => {
  const openapi = await fetch(
    new URL(request.url).origin + "/openapi.json",
  ).then((res) => res.json());

  const baseUrl = openapi["x-origin-servers"][0].url;

  const json = await request.json();
  const headers: { [k: string]: string } = {};

  const neededHeaders = ["x-api-key", "anthropic-version", "content-type"];
  request.headers.forEach((value, key) => {
    if (neededHeaders.filter((x) => x === key).length === 0) {
      return;
    }
    headers[key] = value;
  });

  const result = await fetch(baseUrl + "/messages", {
    method: request.method,
    body: JSON.stringify(json),
    headers: new Headers(headers),
  });

  return result;
};

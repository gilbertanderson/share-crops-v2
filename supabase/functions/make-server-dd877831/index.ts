// Supabase Edge API is intentionally disabled.
//
// Browser failover now uses only the Vercel API deployments. The old Edge shared
// app drifted behind server/app.ts security fixes, so serving it here would
// expose stale authorization behavior if called directly.
function responseHeaders(request: Request): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-max-age": "600",
  });
  const origin = request.headers.get("origin");
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

Deno.serve((request) => {
  const headers = responseHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(request.url);
  if (url.pathname.endsWith("/health")) {
    return new Response(
      JSON.stringify({ status: "disabled", edgeApiDisabled: true }),
      { status: 200, headers },
    );
  }

  return new Response(
    JSON.stringify({
      error: "Supabase Edge API is disabled. Use the Vercel /api deployment.",
    }),
    { status: 503, headers },
  );
});

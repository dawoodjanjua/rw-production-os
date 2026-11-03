import "server-only";

/**
 * Public origin of the app for redirects. Behind a hosting proxy, request.url can show the internal
 * bind address (e.g. https://0.0.0.0:3000), so prefer NEXT_PUBLIC_SITE_URL, then the forwarded host.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host && !/^0\.0\.0\.0|^127\.|^localhost:\d+$/.test(host)) {
    return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  }
  return new URL(request.url).origin;
}

const recentRequests = new Map<string, number[]>();

/** Simple in-memory sliding window per client and route. */
export function rateLimited(request: Request, bucket: string, perMinute: number) {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${bucket}:${client}`;
  const now = Date.now();
  const recent = (recentRequests.get(key) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  recentRequests.set(key, recent);
  if (recentRequests.size > 5000) recentRequests.clear();
  return recent.length > perMinute;
}

export class SynchroRateLimitObject {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.key || !body.route || !body.limit || !body.windowSeconds) {
      return Response.json({ allowed: false, retryAfter: 60 }, { status: 400 });
    }

    const now = Date.now();
    const windowMs = Math.max(1, Number(body.windowSeconds)) * 1000;
    const limit = Math.max(1, Number(body.limit));
    const storageKey = `${body.route}:${body.key}`;
    const current = (await this.state.storage.get(storageKey)) || {
      count: 0,
      resetAt: now + windowMs,
    };

    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }

    current.count += 1;
    await this.state.storage.put(storageKey, current, {
      expirationTtl: Math.ceil(windowMs / 1000) + 60,
    });

    const allowed = current.count <= limit;
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));

    return Response.json({
      allowed,
      limit,
      remaining: Math.max(0, limit - current.count),
      retryAfter,
    });
  }
}

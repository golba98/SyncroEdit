# Worker Database Boundary

The Cloudflare Worker does not run Mongoose or connect directly to MongoDB.

Current database ownership stays with the Node backend. Worker routes that need user, session,
document, history, or collaboration persistence must proxy to Node until a tested D1, Postgres, or
server/API-backed storage path replaces each feature.

Do not place database credentials in `worker/wrangler.toml`.

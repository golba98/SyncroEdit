# Setup Guide for Developers (Cloudflare Native)

This guide helps you set up and run SynchroEdit locally using the Cloudflare Workers, D1 database, and Durable Objects emulator.

## Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- Git

---

## Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/golba98-dev/SynchroEdit.git
cd SynchroEdit
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Initialize D1 Local Database & Apply Schema
Before running the application, create and apply the database schema to your local wrangler D1 emulator:
```bash
npm run db:migrate:local
```

### 4. Run Development Server
Wrangler will compile the Hono worker, start a local D1/Durable Objects emulator, bind the static assets folder (`./public`), and host everything on port `8787`:
```bash
npm run dev
```

Open `http://localhost:8787` in your web browser. You can register an account, login, create, and collaboratively edit documents.

---

## Deploying to Production

When you are ready to publish the application to your Cloudflare account:

### 1. Create a D1 Database
Create a D1 database using wrangler CLI:
```bash
npx wrangler d1 create synchroedit-db
```
Copy the `database_id` from the terminal output and paste it into your `wrangler.toml` file under `[[d1_databases]]`.

### 2. Apply Schema to Production Database
Apply the SQL migrations to your remote production D1 database:
```bash
npm run db:migrate:remote
```

### 3. Configure Secrets
Set the production secret key for JWT session tokens:
```bash
npx wrangler secret put JWT_SECRET
```

### 4. Deploy Static Assets and Worker
Deploy the code and assets directly to your Cloudflare account:
```bash
npm run deploy
```

Cloudflare will deploy your static files to the edge network and expose your APIs globally on a `*.workers.dev` subdomain (or a custom domain if configured).

---

## Troubleshooting

### JWT Token Verification Failures
If you receive 401 Unauthorized errors in local development, ensure that your environment isn't overriding the fallback secret. You can set a custom local secret by adding a `.dev.vars` file in the project root:
```env
JWT_SECRET=my-custom-local-secret-key
```
*Note: Do not commit `.dev.vars` to Git.*

### Local Database Reset
To wipe your local development database and start fresh, run:
```bash
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local
```

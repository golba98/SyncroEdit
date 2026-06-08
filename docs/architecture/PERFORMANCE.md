PERFORMANCE PLAN: ACCELERATING DOCUMENT GENERATION

1. BOTTLENECK ANALYSIS (CURRENT STATE)

- Client-Side Initialization: The browser currently handles the first
  page structure, causing a delay as it waits for a round-trip
  connection before creating content.
- Sequential Loading: The UI loads, then the socket connects, then
  data is fetched. This should be parallelized.
- Database Writes: New documents may be waiting for full database
  confirmation before the UI responds.

2. SERVER-SIDE PRE-INITIALIZATION (THE "HOT START" STRATEGY)
   Goal: Eliminate the client-side "first page creation" step.

- Server-Side Templates: The server generates the initial Yjs binary
  state (with Page 1 pre-created) during the API call.
- Pre-computed State: Keep a "blank document" Yjs buffer in memory.
  Clone this buffer for new docs instead of building it from scratch.
- Zero-Latency Connect: Ensure the document is already populated
  on the server so the client renders it instantly upon first sync.

3. OPTIMISTIC UI AND LOCAL FIRST
   Goal: Make the UI interactive immediately.

- Local Shell Generation: The "New Document" button should instantly
  render a local, temporary editor in memory.
- Background Sync: While the user begins typing, the app handles
  API creation and WebSocket connection in the background.
- Seamless Transition: Merge local changes with the server state
  transparently once the connection is established.

4. DATABASE OPTIMIZATION
   Goal: Reduce API latency.

- Async Persistence: Create document metadata (ID/Owner) instantly,
  deferring heavy state initialization to the socket layer.
- Lightweight Models: Use a small model for the document list.
  Avoid loading full content just to verify a document exists.

5. NETWORK AND CACHING
   Goal: Faster asset delivery.

- Aggressive Caching: Set long-term cache headers for libraries
  like Yjs, WebSocket, and Quill.
- Resource Preloading: Use link preloading in index.html for
  critical scripts.
- Connection Warm-up: Start the WebSocket handshake as soon as
  the user hovers over the "New Document" button.

6. EXECUTION SUMMARY
1. Refactor Backend: Move page creation logic from the client to
   the server controllers.
1. Update API: Ensure document creation returns an ID instantly.
1. Frontend Optimism: Load the editor layout immediately on
   click and swap the URL once the server confirms the ID.

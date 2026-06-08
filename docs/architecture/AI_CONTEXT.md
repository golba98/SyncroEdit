SYNCHROEDIT | PROJECT CONTEXT

1. PROJECT OVERVIEW
   SynchroEdit is a real-time collaborative document editor with a minimalist
   "Dark OLED" aesthetic. It allows multiple users to edit documents
   simultaneously without conflicts, matching industry standards.

2. ARCHITECTURE AND TECHNOLOGY
   The application uses a full-stack JavaScript environment:

- Backend: Node.js and Express.js for the API and static assets.
- Database: MongoDB for persistent storage of users and documents.
- Frontend: Vanilla JavaScript (ES modules) with Quill.js for the editor.
- Real-time: Powered by Yjs and WebSockets (CRDTs) for instant syncing.

3. USER SYSTEM

- Identity: Unique usernames and emails with securely hashed passwords.
- Profiles: Customizable bios, profile pictures, and personal accent colors.
- Status: Real-time online tracking and login history (IP and User Agent).
- Security: Account lockout, email verification, and token-based password resets.

4. THEMING SYSTEM

- Modes: Supports Light and Dark themes (Dark/OLED is the default).
- Dynamic Accents: A custom engine generates a full UI palette from a
  single user-chosen accent color.
- Color Logic: The system calculates hover states, transparency, and
  gradients programmatically instead of using static CSS.
- Visuals: Accent colors affect borders, shadows, glows, and the text cursor.

5. EDITOR AND COLLABORATION

- Rich Text: Full support for bold, italics, lists, and alignment.
- Multi-page Layout: Physical paper simulation with automatic pagination
  instead of infinite scrolling.
- Presence: Real-time cursor tracking with username labels and accent colors.
- Management: Creation, deletion, and "Recent Documents" tracking.

6. DIRECTORY STRUCTURE

- /public/js/app: Frontend entrypoint, network helpers, and shared utilities.
- /public/js/features/editor: Quill-to-Yjs binding logic and editor managers.
- /public/js/features/library: Document library management.
- /public/js/features/profile: Profile UI and account settings.
- /public/js/features/ui: Modals, toolbar controls, and UI rendering helpers.
- /src/auth, /src/documents, /src/users: Feature-local backend models, routes, and controllers.
- /src/documents/socket.js: WebSocket handling and sync logic.

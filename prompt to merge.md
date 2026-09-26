I have TWO SEPARATE PROJECTS that need to be combined carefully.

PROJECT 1:
ArcGPT-Frontend

PROJECT 2:
ArcGPT-Backend


==================================================
PROJECT 1 — ArcGPT-Frontend
==================================================

LOCATION:
[PATH TO ArcGPT-Frontend]

This project contains the FINAL USER INTERFACE that I want to keep.

The frontend is already designed and refined.

KEEP THIS FRONTEND.

It contains:
- ArcGPT landing page
- ArcGPT chat interface
- Chat history sidebar
- Conversation list
- Search/input bar
- Yellow/gold accent system
- Pure black theme
- ArcGPT branding
- Favicon
- Liquid-metal send button
- Custom chat generation animation
- Text/UI animations
- Responsive layout
- Existing user interactions
- Existing visual design

This frontend is the source of truth for the final application's appearance.

DO NOT replace this frontend with the frontend from Project 2.

DO NOT redesign it.

DO NOT import Project 2's AI-generated frontend.

==================================================
PROJECT 2 — ArcGPT-Backend
==================================================

LOCATION:
[PATH TO ArcGPT-Backend]

This project contains the BACKEND that I actually want to use.

It has the better:
- LLM integration
- ERP/database integration
- AI logic
- database access
- tools/function calling
- prompts/context
- model configuration
- backend services

KEEP THIS BACKEND.

Project 2's frontend, if present, is NOT wanted.

Ignore/discard its frontend.

==================================================
FINAL GOAL
==================================================

Create ONE ArcGPT application using:

FRONTEND:
ArcGPT-Frontend

BACKEND:
ArcGPT-Backend

The final architecture should be:

                  USER
                    │
                    ▼
          ┌──────────────────┐
          │  ArcGPT FRONTEND │
          │                  │
          │ Project 1        │
          │                  │
          │ Existing UI      │
          └────────┬─────────┘
                   │
                   │ API
                   ▼
          ┌──────────────────┐
          │  ArcGPT BACKEND  │
          │                  │
          │ Project 2        │
          │                  │
          │ Better LLM       │
          │ ERP / Database   │
          │ AI Tools         │
          └──────────────────┘


==================================================
CRITICAL RULE
==================================================

DO NOT blindly merge the two projects.

This is NOT:

"combine both projects"

This IS:

"KEEP THE FRONTEND FROM PROJECT 1 AND REPLACE ITS BACKEND WITH PROJECT 2."

Think of Project 1 as the BODY/UI.

Think of Project 2 as the BRAIN/BACKEND.

==================================================
PHASE 1 — INSPECT BOTH PROJECTS FIRST
==================================================

Before changing ANY code:

Inspect ArcGPT-Frontend.

Determine:

1. Frontend framework
2. Build system
3. Entry points
4. Current API calls
5. Current backend communication
6. Existing server/backend files
7. Chat submission flow
8. Streaming implementation
9. Conversation/thread state
10. Sidebar/history implementation
11. Environment variables
12. Existing backend dependencies

Then inspect ArcGPT-Backend.

Determine:

1. Backend framework
2. Backend entry point
3. API endpoints
4. Request formats
5. Response formats
6. Streaming method
7. Conversation/session system
8. Authentication
9. CORS
10. LLM provider/model
11. Database connection
12. ERP/database tools
13. Environment variables
14. Required dependencies
15. How the backend is started

DO NOT MODIFY ANYTHING DURING THIS INSPECTION.

First understand both architectures.

==================================================
PHASE 2 — FIND THE API CONTRACT
==================================================

Identify exactly how ArcGPT-Frontend currently sends a message.

For example:

POST /api/chat

with:

{
  "message": "hello"
}

Then identify exactly how ArcGPT-Backend expects a message.

For example:

POST /chat

with:

{
  "query": "hello"
}

If the formats differ, DO NOT rewrite the frontend.

Create an adapter layer.

For example:

ArcGPT UI
   ↓
frontend chat API adapter
   ↓
ArcGPT Backend API

The UI should remain unaware of backend-specific implementation details.

==================================================
PHASE 3 — PRESERVE STREAMING
==================================================

If ArcGPT-Backend supports streaming responses, preserve that.

Do not unnecessarily convert streaming into a normal request/response.

The existing ArcGPT frontend should receive the streamed response and display it using its existing chat UI.

The frontend controls:
- loading state
- generation animation
- message rendering
- text appearance

The backend controls:
- LLM
- reasoning/tool execution
- ERP/database access
- response generation

==================================================
PHASE 4 — DATABASE / ERP
==================================================

All ERP/database access MUST remain in ArcGPT-Backend.

The browser/frontend must NEVER directly access the database.

Correct:

Frontend
   ↓
Backend
   ↓
LLM/tools
   ↓
ERP database

Incorrect:

Frontend
   ↓
Database


Never expose:
- database credentials
- LLM API keys
- private backend secrets

to the frontend.

==================================================
PHASE 5 — CONVERSATIONS
==================================================

Preserve the existing ArcGPT sidebar and chat-history UI.

If ArcGPT-Backend already has conversation/session handling:

connect the existing sidebar to it.

Do NOT replace the sidebar UI.

Only replace its data source/API if necessary.

Existing:

+ New thread

must continue to work.

Existing conversation history should continue to work.

==================================================
PHASE 6 — ENVIRONMENT VARIABLES
==================================================

Do not hardcode backend URLs.

Use an environment variable.

For example:

VITE_BACKEND_URL=http://localhost:8000

for development.

Production should use the deployed backend URL.

NEVER put backend secrets inside VITE_* frontend variables.

==================================================
PHASE 7 — REMOVE THE OLD BACKEND
==================================================

ONLY after the new backend is successfully connected:

Identify everything in ArcGPT-Frontend that belongs to its OLD backend.

This may include:

- old API routes
- old server.ts
- old LLM calls
- old database logic
- old backend services
- old backend environment variables
- old backend dependencies

Remove them only after confirming the frontend no longer depends on them.

Do NOT accidentally remove frontend functionality.

==================================================
PHASE 8 — DO NOT TOUCH THE UI
==================================================

The existing ArcGPT frontend is already designed.

Do NOT change:

- layout
- colors
- typography
- spacing
- animations
- sidebar design
- chat design
- search bar
- liquid-metal send button
- loading animation
- logo
- favicon
- responsive behavior

unless a change is strictly required to connect the new backend.

Backend migration must NOT become a UI redesign.

==================================================
PHASE 9 — FINAL PROJECT STRUCTURE
==================================================

Prefer a clean structure such as:

ArcGPT/
│
├── frontend/
│   └── ArcGPT-Frontend code
│
└── backend/
    └── ArcGPT-Backend code

The Project 2 frontend should NOT be carried into the final application.

The Project 1 old backend should NOT remain if it is no longer required.

==================================================
PHASE 10 — TEST EVERYTHING
==================================================

After integration:

1. Start backend.
2. Start frontend.
3. Open landing page.
4. Send a normal message.
5. Verify response comes from ArcGPT-Backend.
6. Test an ERP/database question.
7. Verify the backend accesses the database correctly.
8. Test streamed responses if supported.
9. Test chat history.
10. Test sidebar.
11. Test + New thread.
12. Test multiple messages in one conversation.
13. Test backend errors.
14. Test loading/generation animation.
15. Test responsive layout.
16. Verify admin panel remains untouched.
17. Run production build.

==================================================
MOST IMPORTANT RULE
==================================================

DO NOT MERGE THE PROJECTS BLINDLY.

PROJECT 1:
ArcGPT-Frontend
→ KEEP ITS FRONTEND.

PROJECT 2:
ArcGPT-Backend
→ KEEP ITS BACKEND.

Project 1's old backend:
→ REPLACE.

Project 2's frontend:
→ IGNORE.

The final result should look exactly like the existing ArcGPT UI, but its intelligence, database access, and LLM processing should come entirely from ArcGPT-Backend.

Before making modifications, inspect both projects and explain the exact integration points you found.

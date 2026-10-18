# ClipForge

A dark, professional SaaS foundation for an AI video clipping platform.

## Included in this milestone

- Responsive app shell with sidebar navigation
- Dashboard with project summary cards and recent projects
- Projects list and project detail routes
- Reusable buttons, badges, stat cards, and empty states
- New project form that creates a local demo project in browser memory
- Clear UI labels for features that are not implemented yet

## Not implemented yet

- Authentication and user accounts
- Database persistence
- Real video upload/storage
- Transcription, AI clip selection, rendering, or export
- Background processing jobs

The project form currently creates a demo project in client-side state only. Refreshing the page resets demo state. No fake AI processing is shown as complete.

## Run locally

Requires Node.js 20.9+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Push this project to a GitHub repository.
2. In Vercel, select **Add New → Project** and import the repository.
3. Keep the default Next.js build settings.
4. Deploy.

No environment variables are required for this foundation.

## Suggested next milestone

Add Supabase authentication and persistent projects, then implement direct-to-storage video uploads. Keep video processing in a separate worker rather than inside a Vercel request handler.

# Classroom Collaborative Writing Platform

A real-time collaborative writing platform for classrooms, built with React, TypeScript, Firebase, Yjs, and Tiptap.

## Features

- **Real-time collaborative editing** using Yjs CRDT and Firebase RTDB
- **Teacher review mode** with annotations, highlights, and comments
- **Document lifecycle state machine**: Writing → Submitted → Reviewing → Reviewed
- **Student group isolation** with Firestore security rules
- **Quota monitoring** for Firebase free tier limits
- **Live teacher dashboard** with class and student monitoring

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite
- **Editor**: Tiptap (ProseMirror) with Yjs collaboration
- **Backend**: Firebase (Firestore, RTDB, Auth)
- **State Management**: React hooks + custom service layer
- **Testing**: Vitest, React Testing Library, Firebase Rules Unit Testing

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore and RTDB enabled
- Firebase CLI (`npm install -g firebase-tools`)

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your Firebase configuration:

```bash
cp .env.example .env
# Edit .env with your Firebase project values
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

## Project Structure

```
src/
├── config/          # Firebase initialization
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
├── services/        # Firestore/RTDB service layer
├── hooks/           # Custom React hooks
├── components/      # Reusable UI components
│   ├── common/      # Button, Input, Modal, Toast, StatusBadge
│   ├── editor/      # CollaborativeEditor, AnnotationHighlighter, etc.
│   └── teacher/     # ClassForm
└── pages/           # Route components
    ├── auth/        # TeacherLogin, TeacherRegister
    ├── teacher/     # TeacherDashboard, ClassDetail, LiveMonitoring, ReviewMode
    └── student/     # StudentJoin, StudentWorkspace
```

## Security

Firestore security rules enforce:
- Student group isolation (students can only access their own group's documents)
- Teacher authorization (only the class teacher can modify class data)
- Locked document write-denial (students cannot modify locked documents)
- Annotation teacher-only writes (students cannot create annotations)

See `docs/SECURITY_AUDIT.md` for the full security audit.

## Deployment

### Firebase Hosting

```bash
firebase init hosting
firebase deploy --only hosting
```

### CI/CD

GitHub Actions workflow is configured in `.github/workflows/deploy.yml`. It runs typecheck, tests, and build on every push, then deploys to Firebase Hosting on merge to main.

## Firebase classroom peer review

Teachers control student peer review from the class page using **Allow peer review** / **Close peer review**. Once enabled, students whose group has submitted can read and comment on other submitted groups' essays from their workspace. The comments use the existing Firestore comments collection and do not require Supabase environment variables. Deploy the updated `firestore.rules` when publishing this feature; the rules enforce the teacher toggle, group submission status, and class membership.

An optional checklist can also be created for structured reviews. It is not required for students to read essays or leave comments.

## Supabase inline peer feedback (separate teacher feature)

Teachers can choose **Peer feedback** in the existing teacher review workspace to inspect the separate Supabase inline feedback stream. The student workspace instead uses the Firebase classroom peer-review flow above. The existing checklist, Firestore comment/reply system, voting, writing editor, Firebase authentication, and routing remain available.

New inline comments, exact text selections, immutable essay snapshots, and emoji reactions live in Supabase. Existing Firebase comments are retained separately; they are not migrated or duplicated. Highlight offsets use JavaScript UTF-16 positions, not a search for matching words. Overlapping comments are supported. When essay text changes, old comments keep their original quoted passage and are labeled as an earlier version instead of highlighting unrelated text.

### One-time connection and deployment

1. Select a Supabase project. In its Authentication settings, enable the Firebase third-party integration for this application's existing Firebase project ID. See [Supabase Firebase integration](https://supabase.com/docs/guides/auth/third-party/firebase-auth). This implementation accepts verified Firebase tokens with or without an `authenticated` role claim; it does not change Firebase login or require custom claims.
2. Apply `supabase/migrations/202611270001_peer_review.sql` in the Supabase SQL editor or through the Supabase CLI after linking the project. It creates the tables, restrictive read access, and Realtime publication entries. Do not expose the private grant table through the Data API.
3. Set the Edge Function secret `FIREBASE_PROJECT_ID` to the existing Firebase project ID. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its hosted Edge Functions automatically. Never put the service-role key in a browser variable.
4. Deploy the function: `supabase functions deploy peer-review --no-verify-jwt`. The function itself validates Firebase JWT signatures, issuer, audience, and expiry with Google's public keys. The Supabase legacy JWT gateway is disabled because Firebase issues these tokens.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`) to an ignored `.env.local`, or supply them as environment variables when starting/building Vite. Restart the dev server. Production builds need the same public variables supplied by the build environment; the existing deployment workflow has not been changed.

The teacher Supabase feedback UI reports an unavailable connection until these steps are complete. It never substitutes local storage or silently writes Supabase feedback to Firebase.

### Access and synchronization

All writes go through the Edge Function, which reads current class, membership, group submission, and essay status from Firebase under the caller's existing Firestore rules. Author identity and name are derived there, not trusted from browser input. Students cannot write feedback to their own essay, review before submission, or access other classrooms. Teachers can read every group's feedback. The peer-review API has no essay-edit operation.

Supabase clients have SELECT permissions only. Read policies require a short-lived grant matching the Firebase user ID, token issuer, class, and group. A public anon key alone grants no access. The function renews read access for 120 seconds; open views recheck it every 60 seconds and on reconnect/focus. Membership or submission revocation therefore takes at most 120 seconds to expire existing read grants; every new write rechecks Firebase immediately. Firebase and Postgres cannot provide an atomic cross-database status transaction.

Realtime Postgres change subscriptions refresh comments and reactions, including reaction removals. Reconnects refetch persisted data. A visible connection indicator and manual refresh remain available, with a 60-second refresh fallback. Retried comment requests use an idempotency ID, and reactions have a unique user/essay/emoji constraint. Draft text is retained on a failed save.

### Verification after deployment

- Use two student sessions in distinct groups of the same class and one teacher session. Submit both essays. Verify that a new comment, overlapping highlights, and emoji toggle appear in the other sessions without refresh; then reload and verify persistence.
- Verify selection of the second occurrence of a repeated phrase, multiline text, emoji, and keyboard highlight activation. Check narrow/mobile layouts.
- Verify unsubmitted students and unrelated-class users cannot read or write; owners and teachers can view but cannot create peer feedback. Direct anonymous table requests must return no rows and direct writes must be denied.
- Return an essay for revision: new writes must fail immediately, and existing read grants must expire within 120 seconds. Submit changed text again and check old feedback is labeled rather than incorrectly highlighted.

Local tests cover selection anchors, overlapping ranges, server-side eligibility, and UI interactions. Live persistence and multi-device synchronization require the configured and deployed Supabase project.

## License

MIT

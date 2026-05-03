# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lediary — English diary app. Pick a mode (Morning / Lesson / Diary / Story), write in Japanese, then in English; the AI corrects your translation with progressive difficulty, suggests vocabulary, and offers 5W1H expansion questions to deepen the entry. Day One-inspired timeline + cover gradients computed from mode × time of day.

## Commands

```bash
# Frontend (the active app, ported from old vanilla TS in 2026-05)
cd web && npm install
cd web && npm run dev          # Vite dev :5180
cd web && npm run build        # tsc --noEmit + vite build → web/dist/
cd web && npm run deploy       # build + firebase deploy --only hosting:lediary-v2  (legacy script name)

# Legacy app (kept readable at lediary-v2.web.app for safety, will be retired)
cd web-legacy && npm run dev
cd web-legacy && npm run build

# Backend
cd functions && npm run build
cd functions && npm run deploy

# Combined deploy
firebase deploy --only hosting:lediary,functions:api --project otokichi-app
```

## Architecture

### Layout
- **`web/`** — Active frontend. Vanilla TypeScript + Vite, page-routed SPA, Firebase Auth, vite-plugin-pwa for installable PWA. Style: Day One-inspired timeline, Lora serif body, cover gradients computed from mode + time of day.
- **`web-legacy/`** — Pre-2026-05 implementation, kept at `lediary-v2.web.app` until confidence in the new build is high. Same backend.
- **`functions/`** — Cloud Functions Node.js 22 2nd gen. `api` handles `/api/diary/*`, `sendDailyReminder` is a scheduled push notification job.

### Writing modes
- **Morning** (sun icon, warm hue 28°) — today's plan / intention
- **Lesson** (graduation icon, blue 215°) — post-lesson reflection
- **Diary** (moon icon, deep blue 250°) — evening diary
- **Story** (book-open icon, sage 145°) — anecdotes / short talk material, time-independent

Each cover is `linear-gradient(135deg, hsl(hue, S%, L1%) 0%, hsl(hue, S%, L2%) 100%)` where saturation/lightness vary with the time the entry was written (morning lighter, night darker).

### URL structure
- `/` — timeline (today's 4-mode cards + recent past entries grouped by day)
- `/calendar` — month grid; past empty days link to `/editor?date=YYYY-MM-DD`
- `/editor?date=&mode=&action=` — compose; `action=correct|flow` auto-triggers the corresponding API after pre-fill
- `/entry/:id` — entry detail with vocab / shadowing / 日記を膨らませる sections + edit / 再添削 / 流れを整える / レッスンシート / 削除 actions
- `/s/:id` — public lesson sheet (no auth)

### Data flow
- **Compose**: JP → 英訳ヒント button (POST `/api/diary/hints`) → EN → 添削 (POST `/api/diary/posts`) → correction cards. Each card lets the user rewrite by hand; "完成" assembles a final text by replacing each `original` with the user's rewrite (or AI corrected as fallback) and persists via `textOnly: true` POST.
- **Stoic mode** (per-user localStorage `lediary_v2_stoic`): blurs AI corrected version so the learner attempts the rewrite from explanation only.
- **Edit / 再添削 / 流れを整える**: detail page stashes the entry into sessionStorage and navigates to the editor; editor takes the stash on mount → no extra fetch, no FOUC.
- **Expansion**: button generates 3 questions; each answer goes through `/api/diary/correct-answer`; "日記に追記" opens a sentence-level insertion picker, mutates `userTranslation` in place, persists with `textOnly: true` + `expansionQuestions`.
- **Shadowing**: `/api/diary/tts` returns binary audio decoded into a `BufferSource`; speed slider 0.5-1.5x adjusts `playbackRate`; record button captures mic via `MediaRecorder` and plays both back for comparison.
- **Mood**: `analyzeDiary` extracts a 1-word Japanese feeling word (はずむ / 穏やか / 達成感 / もやもや / 集中 等) saved on the post and shown as a pill on the entry's cover.

### Pills shown on each entry's cover
- Mode (e.g. "Morning")
- 節気 (24 sekki — 立夏 / 穀雨 / 夏至 …) computed from the date
- Day-of-year (`122 / 365`)
- Mood (if `analyzeDiary` produced one)

### Backend endpoints (`functions/src/index.ts`)
- `POST /api/diary/posts` — create / update; runs `analyzeDiary` unless `textOnly: true`. AT MOST one feedback item per sentence (prompt + post-processing dedup).
- `GET /api/diary/posts` — list (ordered by createdAt desc)
- `GET /api/diary/posts/:id` — single (rare; web-v2 uses list cache instead to avoid 404s)
- `DELETE /api/diary/posts/:id`
- `POST /api/diary/hints` — translation hints; prompt restricts hints to expressions actually present in the user's JP
- `POST /api/diary/expand` — generate 5W1H expansion questions
- `POST /api/diary/correct-answer` — correct a user-typed expansion answer
- `POST /api/diary/flow-check` — inter-sentence flow suggestions; `suggestion` is a Japanese action sentence ("Anyway を Since に置き換える" 等), insert / replace / delete all read naturally
- `GET /api/diary/tts` — binary TTS audio
- `POST /api/diary/lesson-sheet` — generate WNA-style lesson sheet from a post; returns share id
- `GET /api/diary/lesson-sheet/:id` — public sheet fetch (no auth)
- `sendDailyReminder` — scheduled FCM push to `push_tokens` collection

### Firestore collections
- `lediary-posts/{userId}_{date}_{mode}` — diary posts. Doc id is deterministic so re-saves overwrite. Fields: contentJp, userTranslation, feedback[], vocabulary[], expansionQuestions[], dismissedVocab[], hints[], attemptCount, mode, date, mood, lessonSheetId?, createdAt, updatedAt
- `lediary-sheets/{shareId}` — generated lesson sheets
- `push_tokens/{token}` — FCM tokens (currently written by the flashcards app; v2 web doesn't yet register tokens itself)

## Design system

- **Background**: pure white `#ffffff`; warm surface `#fafaf7` for cards
- **Typography**: Lora serif for body / dates / quotes; system sans for UI
- **Icons**: Lucide-style inline SVG (no emoji per project convention)
- **Spacing**: generous; max content width 720px
- **Cover gradients**: HSL math — hue from mode, saturation/lightness from time-of-day band (dawn 70/50, day 60/40, evening 48/28, night 30/16)
- **No hardcoded weather / location pills** (would need Maps Weather API; deferred)

## External services

| Service | Config |
|---------|--------|
| Google Gemini | `gemini-3.1-flash-lite-preview` via v1beta API, key as Firebase secret |
| Firebase Auth | Project: `otokichi-app`, Google provider |
| Firestore | Native mode, `otokichi-app` |
| Firebase Hosting | Targets: `lediary` (active, → `web/dist`) and `lediary-v2` (kept on `web-legacy/dist` for rollback safety) |
| FCM | Push notification sender (`sendDailyReminder`) |

## Deployment

- Hosting: `npm run deploy` from `web/` or `firebase deploy --only hosting:lediary`
- Functions: `cd functions && npm run deploy`
- Combined: `firebase deploy --only hosting:lediary,functions:api`
- Firebase project: `otokichi-app`, Functions region: `asia-northeast1`
- No GitHub Actions; push the auto-deploy follows the local commit + `firebase deploy` rhythm noted in user memory

## Open follow-ups
- Push token registration in `web/` (only flashcards writes to `push_tokens` today)
- Lesson sheet structure: AI sometimes returns content that's loosely WNA-shaped; could tighten with a prompt rewrite pass + a more polished public sheet template
- Once `web-legacy/` is no longer needed, the `lediary-v2` hosting target + directory can be dropped

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lediary — English diary app with 3 daily writing modes (Morning, Lesson, Diary). AI-powered correction with progressive difficulty, expansion questions, and vocabulary extraction. Day One-inspired design with Lora serif font for English text.

## Commands

```bash
# Frontend development
cd web && npm run dev          # Vite dev server on :5174 (proxies /api to emulator)
cd web && npm run build        # TypeScript check + Vite build → web/dist/
cd web && npm run deploy       # Build + firebase deploy --only hosting:lediary

# Backend development
cd functions && npm run build  # TypeScript compile → functions/lib/
cd functions && npm run deploy # Firebase deploy (functions only)
```

## Architecture

### Two components
- **`web/`** — Vanilla TypeScript + Vite PWA (vite-plugin-pwa, Workbox). Client-side router, Firebase Auth, Lucide icons, Lora font
- **`functions/`** — Firebase Cloud Functions (Node.js 22, 2nd gen). `api` function (HTTP) + `sendDailyReminder` (scheduled)

### Writing modes
- **Morning** (Sunrise icon, orange) — Today's plan/intention
- **Lesson** (GraduationCap icon, blue) — Post-lesson reflection
- **Diary** (Moon icon, dark blue) — Evening diary

### Data flow
- **New entry**: Japanese input → hint button → Gemini generates translation hints → user writes English with hints → submit for correction
- **Correction**: Progressive levels — 1st: grammar/transitions, 2nd: naturalness, 3rd: native-level refinement. Previous feedback sent as `original → corrected` pairs to prevent contradictions
- **Expansion**: 3 follow-up questions (5W1H) → user answers → AI correction → insert into diary. State persisted per question
- **Vocabulary**: Extracted from corrected sentences only. Dismissible (saved to `dismissedVocab`)
- **Flashcard integration**: Text selection → floating "Flashcardに保存" button → saves to web API with sentence context

### API endpoints (`functions/src/index.ts`)
- `POST /api/diary/posts` — Create/update with AI analysis, `textOnly` mode for edits, supports `expansionQuestions` and `dismissedVocab` updates
- `GET /api/diary/posts` — List posts (ordered by `createdAt` desc, requires composite index)
- `GET /api/diary/posts/:id` — Get single post
- `DELETE /api/diary/posts/:id` — Delete post
- `POST /api/diary/hints` — Generate translation hints (base form, no duplicates)
- `POST /api/diary/expand` — Generate new expansion questions
- `POST /api/diary/correct-answer` — Correct expansion answer

### Scheduled function
- `sendDailyReminder` — 7:00 JST daily, sends push notifications for due flashcards

### Frontend structure (`web/src/`)
- `main.ts` — Entry point
- `router.ts` — Client-side routing with auth guard
- `pages/home/` — Today's 3 mode cards + diary list (localStorage cache)
- `pages/editor/` — Editor with mode-specific UI, sticky JP text, edit/save, vocab dismiss
- `components/text-selection-bookmark.ts` — Flashcard save via text selection (sentence-level context)

### Firestore
- Collection: `lediary-posts`
- Doc ID: `{userId}_{date}_{mode}`
- Fields: `userId`, `contentJp`, `userTranslation`, `mode`, `feedback[]`, `vocabulary[]`, `expansionQuestions[]`, `dismissedVocab[]`, `hints[]`, `attemptCount`, `date`, `createdAt`, `updatedAt`
- Index: `userId` ASC + `createdAt` DESC (composite)

## Design

- **Day One inspired**: Warm off-white background (#faf8f5), Lora serif for English, borderless textareas, generous whitespace
- **Icons**: Lucide (tree-shaken: Sunrise, GraduationCap, Moon, CheckCircle)
- **Mode colors**: Morning=orange, Lesson=blue, Diary=dark blue
- **No emojis** — all icons are Lucide SVG

## External services

| Service | Config |
|---------|--------|
| Google Gemini | `gemini-3-flash-preview` via v1beta API, key as Firebase secret |
| Firebase Auth | Project: `otokichi-app` |
| Firestore | Native mode, `otokichi-app` |
| Firebase Hosting | Target: `lediary`, URL: `https://lediary.web.app` |
| FCM | Push notification sender (sendDailyReminder) |

## Deployment

- **Hosting**: `cd web && npm run deploy`
- **Functions**: `cd functions && npm run deploy` or `firebase deploy --only functions:api`
- **Both**: `firebase deploy --only hosting:lediary,functions:api`
- Firebase project: `otokichi-app`, Functions region: `asia-northeast1`

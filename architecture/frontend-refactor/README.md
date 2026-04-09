# Frontend Refactor Log

This directory is a tracked engineering log for the frontend architecture refactor.

The purpose is not just to record what changed, but why the change exists, which boundary it is trying to enforce, and what still remains unresolved.

## Why This Exists

The previous frontend architecture concentrated too much product behavior into `src/App.tsx` and a small number of large utility-controller files.

That created three problems:

1. Intent was getting lost as code moved.
2. UI files were too close to utility and orchestration logic.
3. Refactors were hard to evaluate because there was no written boundary model.

This log exists so the repo keeps the reasoning, not just the result.

## Refactor Principles

These are the rules we are actively enforcing during the refactor.

- UI components render and emit events. They should not own utility helpers, media APIs, or domain orchestration.
- Pages compose route-level screens. They should not contain recording engines, API clients, or persistence rules.
- Feature hooks own side effects and workflow orchestration.
- Shared helpers are pure and framework-light.
- Domain selectors and mappers should live next to the feature or entity they describe, not inside `App.tsx`.
- We are not changing product behavior unless explicitly needed to preserve architecture boundaries or fix regressions.

## Current Refactor Goals

- reduce `App.tsx` to a shell-level composition layer
- move media and socket behavior out of route rendering
- remove formatting and helper functions from UI component files
- make the recording pipeline separable into smaller focused modules
- keep the repo hackathon-friendly without making the next production step harder

## Completed So Far

### Phase 1. Shell and feature boundaries

Completed:

- route handling moved into `src/app/router/useAppRoute.ts`
- analysis uploads moved into `src/features/analysis-uploads`
- backend recording sync moved into `src/features/recordings-sync`
- template rendering moved into `src/features/video-templates`
- phone auth resolution moved into `src/features/auth-by-phone`
- recording-library mapping moved into `src/features/recording-library`
- selector logic moved into `src/features/kiosk-session`
- page-level route composition moved into `src/pages`

Result:

- `App.tsx` no longer owns every system concern directly

### Phase 2. UI cleanup

Completed:

- formatting helpers moved out of UI files into `src/shared/lib`
- live-analysis presentation helpers moved out of `RecordingScreen.tsx`
- overlay constant moved out of `RecordingScreen.tsx`

Result:

- component files are more render-focused

## Current Focus

We are now splitting `src/features/recording-session/model/useRecordingSession.ts`.

Why:

- it is still too large
- it still mixes asset lifecycle, live socket lifecycle, capture lifecycle, and reducer synchronization
- it is the main remaining concentration point after shrinking `App.tsx`

Target sub-boundaries:

- local recording assets
- live analysis socket and sampled frame bridge
- reducer sync for live rep events
- capture teardown and countdown lifecycle
- recording upload/finalization flow

### Phase 3. Recording-session split

Completed:

- local recording asset lifecycle extracted into `src/features/recording-session/model/useRecordingAssets.ts`
- live analysis socket transport extracted into `src/features/recording-session/model/useLiveAnalysisSession.ts`
- live rep reducer synchronization extracted into `src/features/recording-session/model/useLiveRepSync.ts`
- capture teardown extracted into `src/features/recording-session/model/captureLifecycle.ts`

Result:

- `useRecordingSession.ts` is now a coordinator over smaller focused modules instead of being the sole implementation location
- intent is easier to trace because transport, asset cleanup, and reducer sync are now separate reasons-to-change

Remaining debt:

- `useRecordingSession.ts` still coordinates start, stop, cancel, reset, countdown, and upload-finalization in one file
- the next sensible split would be countdown/preflight vs finalize/upload

## What We Are Explicitly Not Doing Right Now

- changing state management library
- changing CSS architecture
- rewriting the reducer from scratch
- changing backend contracts
- removing prototype product behavior
- migrating to a monorepo toolchain

## How To Use This Log

When making another frontend architecture change:

1. add the intended boundary and reason first
2. make the code change
3. update the outcome and any follow-up debt

That keeps future contributors from having to reverse-engineer the intention from the diff alone.

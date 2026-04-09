# Recording Session Split

This note documents the intention behind splitting the recording-session controller.

## Problem

`src/features/recording-session/model/useRecordingSession.ts` currently owns too many responsibilities:

- local raw recording asset lifecycle
- live analysis socket state
- sampled frame transport
- capture teardown
- countdown lifecycle
- browser recording start and stop
- upload and finalize flow
- reducer synchronization for live rep events

This is better than keeping everything in `App.tsx`, but it is still one oversized workflow module.

## Target Shape

The recording session should become a small coordinator over smaller focused hooks or modules.

Desired boundaries:

- `useRecordingAssets`
  - owns local raw recording `blob:` URLs
  - owns revoke and cleanup rules

- `useLiveAnalysisSession`
  - owns `liveAnalysis`
  - owns `liveAnalysisState`
  - owns WebSocket attach and teardown
  - owns sampled frame sending

- `useLiveRepSync`
  - owns reducer synchronization from backend rep count to local rep events

- `captureLifecycle`
  - owns generic capture teardown and countdown cleanup helpers

- `useRecordingSession`
  - remains as the coordinator that wires the smaller hooks together
  - owns user-triggered actions like start, stop, cancel, and reset

## Why This Boundary Matters

Without this split:

- recording behavior remains difficult to test in isolation
- live socket concerns stay coupled to blob storage concerns
- future changes like background uploads or alternate capture modes will keep landing in one file

With this split:

- local media handling can evolve independently
- live analysis transport can evolve independently
- recording flow bugs become easier to localize

## Migration Rule

Each extraction must preserve behavior first and improve architecture second.

That means:

- do not change payload shapes
- do not change reducer actions
- do not change screen behavior unless fixing a regression
- prefer moving logic over redesigning logic

## Success Condition

This split is successful when:

- `useRecordingSession.ts` reads like orchestration instead of implementation detail
- each extracted module has one reason to change
- the top-level hook is easier to scan than the current 600+ line version

## Completed In This Pass

The following extractions are now implemented:

- `useRecordingAssets`
- `useLiveAnalysisSession`
- `useLiveRepSync`
- `captureLifecycle`

What remains in `useRecordingSession` after this pass:

- start-recording preflight
- countdown sequencing
- transition from countdown to active recording
- stop and cancel handling
- upload and finalize orchestration

This is acceptable for now because those concerns are still tightly coupled to each other, but they are no longer coupled to local asset storage or live socket implementation details.

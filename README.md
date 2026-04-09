# Cult Vision Kiosk

Shared-device gym recording kiosk built with React + TypeScript + Vite on the frontend and FastAPI + MediaPipe Pose Landmarker on the backend.

The product flow is now backend-assisted:
- dummy phone-number login on the kiosk
- real browser camera recording with `MediaRecorder`
- live frame sampling over WebSocket during recording
- server-side exercise analysis and scoring
- recordings library with playback + delete
- `/analysis` route for analyzing kiosk recordings or uploaded files

## Stack

- Frontend: React, TypeScript, Vite
- Backend: Python, FastAPI, SQLAlchemy
- Pose engine: MediaPipe Pose Landmarker
- Local dev persistence: SQLite + filesystem storage
- Production-ready storage hooks: Postgres via `DATABASE_URL`, S3-compatible storage via env config

## Install

### Frontend

```bash
npm install
```

### Backend

```bash
python3 -m venv .venv-backend
.venv-backend/bin/pip install -r backend/requirements.txt
```

On first real analysis run, MediaPipe downloads the pose model into `backend/models/`.

## Run locally

### One command

Once frontend dependencies and the backend virtualenv are installed, you can run everything with:

```bash
npm start
```

That launches:
- FastAPI backend on `127.0.0.1:8000`
- Vite frontend on `localhost:5173`

Use `Ctrl+C` to stop both.

### Manual mode

Start the backend first:

```bash
npm run api:dev
```

Then start the frontend:

```bash
npm run dev
```

Open:
- Kiosk: `http://localhost:5173`
- Analysis: `http://localhost:5173/analysis`
- Backend health: `http://127.0.0.1:8000/health`

Vite proxies `/api` traffic to the FastAPI backend on port `8000`.

## Current app flow

### Kiosk states

- `idle`: shared attract screen with inline phone-number entry
- `terms`: dummy T&C gate shown for newly added users
- `selectUser`: users are authenticated on the device, but one must be explicitly selected
- `ready`: selected user is clearly shown as the owner of the next set, and the next exercise must be chosen
- `recording`: real browser camera preview + guided live backend analysis
- `postRecording`: set summary and handoff actions

### Multi-user shared device logic

- multiple users can authenticate onto the same device session
- only one active user can own the next recording
- switching users is explicit
- `End` removes only the active user
- `Start Over` resets the device session for demo purposes

### Recording + analysis flow

1. User enters any phone number.
2. The app assigns a mock user name and authenticates them onto the shared device.
3. User accepts local dummy T&Cs if they are newly added.
4. User is selected for the next set.
5. User explicitly selects one exercise from `Squat`, `Push-up`, `Lunge`, or `Bicep Curl`.
6. On `Start Recording`, the frontend:
   - opens the browser camera
   - shows the 3-second countdown
   - creates a backend recording session with `POST /api/recordings`
   - opens a live analysis WebSocket
   - samples preview frames at 5 FPS and streams them to the backend
7. During the set, the backend sends guided feedback for the selected exercise:
   - full pose landmarks
   - red / green overlay segments for the relevant body chains
   - rep count
   - live phase + short corrective text
8. On `Stop Recording`, the frontend:
   - finalizes the local video
   - uploads the recorded blob to the backend
   - marks the upload complete
9. The backend re-runs full-video analysis and stores the final canonical result, keeping the selected exercise locked for that kiosk recording.

### What live analysis looks like

Yes, you should be able to see live analysis during recording.

Current behavior:
- the exercise is selected before the set starts, so live guidance is locked to that movement
- while the set is being recorded, the video shows a full pose skeleton overlay
- exercise-relevant chains turn green or red based on live form checks
- the right-side panel shows rep count, current phase, and 2-3 short corrective cues
- the live panel is best-effort and may take a moment to start once your full body is in frame
- the final post-upload result is still the canonical score

Live analysis will only show well when:
- the backend is running
- camera permission is allowed
- one person is clearly visible
- the body is mostly in frame
- the camera angle is close to side-on

## `/analysis` route

`/analysis` now uses the backend, not the old browser-only heuristic path.

You can:
- select kiosk recordings already stored by the backend
- upload new exercise videos from disk
- start analysis jobs
- poll job results
- review exercise classification, reps, overall score, sub-scores, and feedback
- delete kiosk recordings

## Backend API

Implemented routes:

- `POST /api/recordings`
- `POST /api/recordings/{recordingId}/upload`
- `POST /api/recordings/{recordingId}/upload-complete`
- `GET /api/recordings`
- `DELETE /api/recordings/{recordingId}`
- `POST /api/analysis/jobs`
- `GET /api/analysis/jobs`
- `GET /api/analysis/jobs/{jobId}`
- `GET /api/assets/{storage_key}`
- `WS /api/live-analysis/{recordingId}`

## Data model

### Frontend

- `User`: seeded or generated member identity
- `AuthenticatedUserSession`: device-scoped authenticated presence
- `Recording`: kiosk session recording metadata and ownership
- `RecordingLibraryItem`: merged local + backend recording view model
- `KioskState`: reducer-backed shared-device state

### Backend

- `recordings`
- `analysis_jobs`
- `analysis_results`
- `rep_events`

## Supported exercise logic

Current v1 classifier + scoring is rule-based on top of pose landmarks.

Supported guided classes:
- `Squat`
- `Push-up`
- `Lunge`
- `Bicep Curl`
- `Unknown`

Current scoring dimensions:
- range of motion
- stability
- tempo
- setup quality

## Local development defaults

By default the backend uses:
- SQLite database at `backend/data/cult_vision.db`
- local file storage at `backend/data/storage`

Optional production-oriented env overrides:

- `DATABASE_URL`
- `STORAGE_BACKEND=s3`
- `STORAGE_DIR`
- `S3_BUCKET`
- `S3_ENDPOINT_URL`
- `S3_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `STORAGE_PUBLIC_BASE_URL`
- `MEDIAPIPE_MODEL_PATH`
- `MEDIAPIPE_MODEL_URL`
- `ANALYSIS_FRAME_SAMPLE_FPS`

## Verification

Frontend:

```bash
npm run build
```

Backend import check:

```bash
MPLCONFIGDIR=backend/data/runtime-cache/matplotlib \
XDG_CACHE_HOME=backend/data/runtime-cache \
PYTHONPYCACHEPREFIX=.pycache \
.venv-backend/bin/python -c 'import backend.app.main; print("backend import ok")'
```

## Known limitations

- Login is still intentionally dummy.
- Exercise scoring is prototype-grade, not coach-validated.
- Best results require a fixed side-angle, full-body capture.
- Live analysis is sampled-frame feedback, not full-resolution streaming inference.
- S3 storage is wired via abstraction/config, but local dev defaults to filesystem storage.
- SQLAlchemy is production-ready for Postgres via `DATABASE_URL`, but local dev defaults to SQLite.

## Recommended next steps

- add real member auth instead of dummy phone entry
- move device session auth and device ownership fully server-side
- persist uploaded analysis files as first-class assets with delete/list endpoints
- add background job queueing for long videos
- add stronger exercise models beyond squat / push-up / lunge / bicep curl
- add tests around reducer transitions, API contracts, and scoring heuristics

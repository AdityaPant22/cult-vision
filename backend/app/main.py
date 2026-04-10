from __future__ import annotations

import asyncio
import base64
import json
import logging
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, List, Optional

import cv2
import requests as http_requests
import time

import numpy as np
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

try:
    from supabase import create_client as create_supabase_client
except ModuleNotFoundError:
    create_supabase_client = None

from .analysis_engine import ExerciseSummary, LivePoseAnalyzerSession, analyze_video_file, generate_id
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import AnalysisJob, AnalysisResult, Recording, RepEvent
from .schemas import (
    AnalysisJobResponse,
    AnalysisJobsListResponse,
    AnalysisResultPayload,
    LiveAnalysisMessage,
    RepEventPayload,
    RecordingCreateRequest,
    RecordingCreateResponse,
    RecordingDeleteResponse,
    RecordingListItem,
    UploadCompleteRequest,
)
from .storage import get_storage_backend


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)

    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(recordings)").fetchall()
        }
        if "selected_exercise" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE recordings ADD COLUMN selected_exercise VARCHAR"
            )
        if "phone_number" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE recordings ADD COLUMN phone_number VARCHAR"
            )
        if "weight_kg" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE recordings ADD COLUMN weight_kg VARCHAR"
            )
        if "cloud_sync_status" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE recordings ADD COLUMN cloud_sync_status VARCHAR"
            )
        if "ai_feedback_json" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE recordings ADD COLUMN ai_feedback_json TEXT"
            )
        if "live_rep_count" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE recordings ADD COLUMN live_rep_count INTEGER"
            )


ensure_schema()

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage = get_storage_backend()

supabase_client = (
    create_supabase_client(settings.supabase_url, settings.supabase_key)
    if create_supabase_client and settings.supabase_url and settings.supabase_key
    else None
)


logger = logging.getLogger("cult_vision")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "google/gemini-2.0-flash-001"


def generate_ai_feedback(summary: ExerciseSummary, weight_kg: str | None = None) -> dict:
    """Call OpenRouter to get structured, motivating feedback categories."""
    if not settings.openrouter_api_key:
        return {}

    weight_line = f"- Weight lifted: {weight_kg} kg" if weight_kg else "- Weight lifted: not provided"

    prompt = f"""You are a supportive and motivating fitness coach. Based on the workout analysis below,
generate feedback in exactly 4 categories: Depth, Stability, Tempo, and Strain.

Rules:
- Depth: be constructive -- give specific, actionable advice on range of motion and how to improve
- Stability: comment on body control, balance, and steadiness during the movement
- Tempo: comment on rep speed, consistency, and rhythm
- Strain: comment on effort level relative to the weight lifted and reps completed
- Be warm, personal, and motivating -- make them want to come back
- Each category value should be 1-2 sentences max
- Return ONLY valid JSON with exactly these 4 keys: "Depth", "Stability", "Tempo", "Strain"

Example output format:
{{"Depth": "Try sitting 2 inches deeper by widening your stance slightly -- this will activate your glutes more.", "Stability": "Great balance throughout your set, your core is doing solid work.", "Tempo": "Nice consistent rhythm across all reps, keep that cadence.", "Strain": "Good effort pushing through 5 reps at 20kg -- you could handle a small bump next session."}}

Workout Analysis:
- Exercise: {summary.exercise}
- Reps completed: {summary.rep_count}
{weight_line}
- Overall score: {summary.overall_score}/100
- Range of motion: {summary.metrics.get('range_of_motion', 0)}/100
- Stability: {summary.metrics.get('stability', 0)}/100
- Tempo: {summary.metrics.get('tempo', 0)}/100
- Setup quality: {summary.metrics.get('setup', 0)}/100
- Form feedback: {'; '.join(summary.feedback)}
- Coaching cues: {'; '.join(summary.cues)}

Return ONLY the JSON object, no markdown fences, no extra text."""

    try:
        resp = http_requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
            },
            timeout=30,
        )
        if not resp.ok:
            logger.warning("OpenRouter request failed (%s): %s", resp.status_code, resp.text[:300])
            return {}

        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(content)
    except Exception as exc:
        logger.warning("AI feedback generation failed: %s", exc)
        return {}


def upload_to_cloudinary(file_bytes: bytes, filename: str) -> str:
    url = f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}/video/upload"
    resp = http_requests.post(
        url,
        files={"file": (filename, file_bytes)},
        data={"upload_preset": settings.cloudinary_upload_preset},
        timeout=300,
    )
    if not resp.ok:
        try:
            detail = resp.json().get("error", {}).get("message", resp.text)
        except Exception:
            detail = resp.text or f"HTTP {resp.status_code}"
        raise HTTPException(status_code=502, detail=f"Cloudinary upload failed: {detail}")
    return resp.json()["secure_url"]


def open_db_session() -> Session:
    return SessionLocal()


def analysis_payload_from_model(
    result: Optional[AnalysisResult],
) -> Optional[AnalysisResultPayload]:
    if result is None:
        return None
    return AnalysisResultPayload(
        exercise=result.exercise,
        confidence=result.confidence,
        rep_count=result.rep_count,
        overall_score=result.overall_score,
        metrics={
            "range_of_motion": result.range_of_motion_score,
            "stability": result.stability_score,
            "tempo": result.tempo_score,
            "setup": result.setup_score,
        },
        feedback=result.feedback,
        cues=result.cues,
        rep_events=[
            RepEventPayload(
                rep_index=event.rep_index,
                timestamp_ms=event.timestamp_ms,
                quality_score=event.quality_score,
                notes=event.notes,
            )
            for event in sorted(result.rep_events, key=lambda item: item.rep_index)
        ],
    )


def job_payload(job: AnalysisJob) -> AnalysisJobResponse:
    return AnalysisJobResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        message=job.message,
        source_label=job.source_label,
        result=analysis_payload_from_model(job.result),
    )


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get(f"{settings.api_prefix}/health")
def api_health_check():
    return {"status": "ok"}


@app.post(f"{settings.api_prefix}/recordings", response_model=RecordingCreateResponse)
def create_recording(
    payload: RecordingCreateRequest, db: Session = Depends(get_db)
):
    recording_id = generate_id("recording")
    live_analysis_token = uuid.uuid4().hex
    started_at = payload.started_at or datetime.utcnow()
    recording = Recording(
        id=recording_id,
        device_id=payload.device_id,
        device_name=payload.device_name,
        zone_name=payload.zone_name,
        user_id=payload.user_id,
        user_name=payload.user_name,
        phone_number=payload.phone_number or None,
        weight_kg=payload.weight_kg or None,
        selected_exercise=payload.selected_exercise,
        started_at=started_at,
        live_analysis_token=live_analysis_token,
        status="recording",
        upload_status="pending",
    )
    db.add(recording)
    db.commit()
    return RecordingCreateResponse(
        recording_id=recording_id,
        upload_url=f"{settings.api_prefix}/recordings/{recording_id}/upload",
        live_analysis_ws_url=f"{settings.api_prefix}/live-analysis/{recording_id}?token={live_analysis_token}",
        live_analysis_token=live_analysis_token,
        started_at=started_at,
    )


@app.post(f"{settings.api_prefix}/recordings/{{recording_id}}/upload")
async def upload_recording_asset(
    recording_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    recording = db.get(Recording, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    content = await file.read()
    extension = Path(file.filename or "recording.webm").suffix or ".webm"
    stored = storage.save_bytes(
        f"recordings/{recording_id}{extension}",
        content,
        mime_type=file.content_type,
    )
    recording.storage_key = stored.storage_key
    recording.asset_url = stored.public_url
    recording.mime_type = stored.mime_type
    recording.upload_status = "uploaded"
    db.commit()
    return {"asset_url": stored.public_url, "mime_type": stored.mime_type}


def run_recording_analysis_job(recording_id: str) -> None:
    db = open_db_session()
    try:
        recording = db.get(Recording, recording_id)
        if not recording or not recording.storage_key:
            return

        job = AnalysisJob(
            id=generate_id("job"),
            recording_id=recording.id,
            source_type="recording",
            source_label=f"{recording.user_name} recording",
            status="processing",
            progress=0.1,
            message="Running final analysis",
            started_at=datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        asset_path = storage.path_for(recording.storage_key)
        if asset_path is None:
            raise RuntimeError("S3-backed video re-analysis is not yet implemented in local mode.")

        summary = analyze_video_file(
            asset_path, selected_exercise=recording.selected_exercise
        )

        authoritative_rep_count = max(
            summary.rep_count,
            recording.live_rep_count or 0,
        )
        if authoritative_rep_count != summary.rep_count:
            logger.info(
                "Rep count corrected for %s: video_analysis=%d, live=%s → using %d",
                recording_id,
                summary.rep_count,
                recording.live_rep_count,
                authoritative_rep_count,
            )
            summary.rep_count = authoritative_rep_count

        job.status = "completed"
        job.progress = 1.0
        job.message = "Analysis complete"
        job.completed_at = datetime.utcnow()

        existing_result = recording.latest_result
        if existing_result:
            db.delete(existing_result)
            db.flush()

        result = AnalysisResult(
            id=generate_id("result"),
            job_id=job.id,
            recording_id=recording.id,
            exercise=summary.exercise,
            confidence=summary.confidence,
            rep_count=authoritative_rep_count,
            overall_score=summary.overall_score,
            range_of_motion_score=summary.metrics["range_of_motion"],
            stability_score=summary.metrics["stability"],
            tempo_score=summary.metrics["tempo"],
            setup_score=summary.metrics["setup"],
            feedback=summary.feedback,
            cues=summary.cues,
        )
        db.add(result)
        db.flush()

        for index, rep_event in enumerate(summary.rep_events, start=1):
            db.add(
                RepEvent(
                    id=generate_id("rep"),
                    result_id=result.id,
                    rep_index=index,
                    timestamp_ms=int(rep_event["timestamp_ms"]),
                    quality_score=int(rep_event["quality_score"]),
                    notes=str(rep_event["notes"]),
                )
            )

        recording.status = "ready"

        try:
            ai_feedback = generate_ai_feedback(summary, recording.weight_kg)
            recording.ai_feedback_json = ai_feedback if ai_feedback else {}
        except Exception as ai_err:
            logger.warning("AI feedback generation failed for %s: %s", recording_id, ai_err)
            recording.ai_feedback_json = {}

        recording.cloud_sync_status = "awaiting_render"
        db.commit()
        logger.info(
            "Recording %s analysis complete, awaiting rendered video for Cloudinary sync",
            recording_id,
        )

    except Exception as error:
        job = (
            db.query(AnalysisJob)
            .filter(AnalysisJob.recording_id == recording_id)
            .order_by(AnalysisJob.created_at.desc())
            .first()
        )
        if job:
            job.status = "failed"
            job.message = str(error)
            job.completed_at = datetime.utcnow()
            db.commit()
        raise
    finally:
        db.close()


@app.post(f"{settings.api_prefix}/recordings/{{recording_id}}/upload-complete")
async def mark_upload_complete(
    recording_id: str,
    payload: UploadCompleteRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    recording = db.get(Recording, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    recording.stopped_at = payload.stopped_at
    recording.duration_sec = payload.duration_sec
    recording.live_rep_count = payload.live_rep_count
    recording.status = "processing"
    recording.upload_status = "complete"
    db.commit()

    background_tasks.add_task(run_recording_analysis_job, recording_id)
    return {"queued": True}


def _sync_rendered_video_to_cloud(recording_id: str, video_bytes: bytes, filename: str) -> None:
    """Background task: upload rendered video to Cloudinary + save metadata to Supabase."""
    db = open_db_session()
    try:
        recording = db.get(Recording, recording_id)
        if not recording:
            return

        recording.cloud_sync_status = "uploading_video"
        db.commit()

        cdn_url = upload_to_cloudinary(video_bytes, filename)

        recording.cloud_sync_status = "video_uploaded"
        db.commit()

        if supabase_client:
            recording.cloud_sync_status = "saving_data"
            db.commit()

            ai_feedback = recording.ai_feedback_json or {}
            result = recording.latest_result

            meta = {
                "dateTime": int(time.time() * 1000),
                "exercise": result.exercise if result else recording.selected_exercise or "unknown",
                "reps": result.rep_count if result else 0,
                "weight_kg": recording.weight_kg or None,
                "form_score": round(result.overall_score / 100, 2) if result else 0,
                "feedback": ai_feedback,
            }

            supabase_client.table("userVedios").insert({
                "cdn_url": cdn_url,
                "phone_number": recording.phone_number or recording.user_id,
                "meta": meta,
            }).execute()

            recording.cloud_sync_status = "synced"
            db.commit()
            logger.info("Rendered video for %s synced to Cloudinary + Supabase", recording_id)

    except Exception as exc:
        try:
            recording = db.get(Recording, recording_id)
            if recording:
                recording.cloud_sync_status = "failed"
                db.commit()
        except Exception:
            pass
        logger.warning("Rendered video sync failed for %s: %s", recording_id, exc)
    finally:
        db.close()


@app.post(f"{settings.api_prefix}/recordings/{{recording_id}}/rendered-video")
async def upload_rendered_video(
    recording_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    recording = db.get(Recording, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    video_bytes = await file.read()
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "webm"
    filename = f"{recording_id}-rendered.{ext}"

    rendered_asset = storage.save_bytes(filename, video_bytes, file.content_type)
    recording.cloud_sync_status = "uploading_video"
    db.commit()

    background_tasks.add_task(_sync_rendered_video_to_cloud, recording_id, video_bytes, filename)
    return {"queued": True, "rendered_storage_key": rendered_asset.storage_key}


@app.get(f"{settings.api_prefix}/recordings", response_model=list[RecordingListItem])
def list_recordings(db: Session = Depends(get_db)):
    recordings = db.query(Recording).order_by(Recording.created_at.desc()).all()
    return [
        RecordingListItem(
            id=item.id,
            user_name=item.user_name,
            device_name=item.device_name,
            zone_name=item.zone_name,
            started_at=item.started_at,
            stopped_at=item.stopped_at,
            duration_sec=item.duration_sec,
            status=item.status,
            asset_url=item.asset_url,
            mime_type=item.mime_type,
            cloud_sync_status=item.cloud_sync_status,
            weight_kg=item.weight_kg,
            latest_result=analysis_payload_from_model(item.latest_result),
        )
        for item in recordings
    ]


@app.delete(f"{settings.api_prefix}/recordings/{{recording_id}}", response_model=RecordingDeleteResponse)
def delete_recording(recording_id: str, db: Session = Depends(get_db)):
    recording = db.get(Recording, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if recording.storage_key:
        storage.delete(recording.storage_key)
    db.delete(recording)
    db.commit()
    return RecordingDeleteResponse()


@app.post(f"{settings.api_prefix}/analysis/jobs")
async def create_analysis_jobs(
    background_tasks: BackgroundTasks,
    recording_ids: Annotated[Optional[List[str]], Form()] = None,
    files: Optional[List[UploadFile]] = File(default=None),
    db: Session = Depends(get_db),
):
    created_jobs: List[AnalysisJobResponse] = []

    for recording_id in recording_ids or []:
        recording = db.get(Recording, recording_id)
        if not recording or not recording.storage_key:
            continue
        job = AnalysisJob(
            id=generate_id("job"),
            recording_id=recording.id,
            source_type="recording",
            source_label=f"{recording.user_name} recording",
            status="queued",
            progress=0.0,
            message="Queued for analysis",
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        background_tasks.add_task(run_job_for_recording_job_id, job.id)
        created_jobs.append(job_payload(job))

    for upload in files or []:
        content = await upload.read()
        extension = Path(upload.filename or "upload.mp4").suffix or ".mp4"
        stored = storage.save_bytes(
            f"analysis-uploads/{generate_id('upload')}{extension}",
            content,
            mime_type=upload.content_type,
        )
        job = AnalysisJob(
            id=generate_id("job"),
            source_type="upload",
            source_label=upload.filename or "Uploaded video",
            uploaded_asset_key=stored.storage_key,
            uploaded_asset_url=stored.public_url,
            status="queued",
            progress=0.0,
            message="Queued for analysis",
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        background_tasks.add_task(run_job_for_upload_job_id, job.id)
        created_jobs.append(job_payload(job))

    return {"jobs": created_jobs}


def run_job_for_recording_job_id(job_id: str) -> None:
    db = open_db_session()
    try:
        job = db.get(AnalysisJob, job_id)
        if not job or not job.recording or not job.recording.storage_key:
            return
        job.status = "processing"
        job.progress = 0.1
        job.started_at = datetime.utcnow()
        job.message = "Running analysis"
        db.commit()

        asset_path = storage.path_for(job.recording.storage_key)
        if asset_path is None:
            raise RuntimeError("S3-backed batch analysis download is not implemented in local mode.")

        summary = analyze_video_file(
            asset_path, selected_exercise=job.recording.selected_exercise
        )
        job.status = "completed"
        job.progress = 1.0
        job.completed_at = datetime.utcnow()
        job.message = "Analysis complete"

        result = AnalysisResult(
            id=generate_id("result"),
            job_id=job.id,
            recording_id=None,
            exercise=summary.exercise,
            confidence=summary.confidence,
            rep_count=summary.rep_count,
            overall_score=summary.overall_score,
            range_of_motion_score=summary.metrics["range_of_motion"],
            stability_score=summary.metrics["stability"],
            tempo_score=summary.metrics["tempo"],
            setup_score=summary.metrics["setup"],
            feedback=summary.feedback,
            cues=summary.cues,
        )
        db.add(result)
        db.flush()

        for index, rep_event in enumerate(summary.rep_events, start=1):
            db.add(
                RepEvent(
                    id=generate_id("rep"),
                    result_id=result.id,
                    rep_index=index,
                    timestamp_ms=int(rep_event["timestamp_ms"]),
                    quality_score=int(rep_event["quality_score"]),
                    notes=str(rep_event["notes"]),
                )
            )

        db.commit()
    except Exception as error:
        job = db.get(AnalysisJob, job_id)
        if job:
            job.status = "failed"
            job.message = str(error)
            job.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


def run_job_for_upload_job_id(job_id: str) -> None:
    db = open_db_session()
    try:
        job = db.get(AnalysisJob, job_id)
        if not job or not job.uploaded_asset_key:
            return
        job.status = "processing"
        job.progress = 0.1
        job.started_at = datetime.utcnow()
        job.message = "Running analysis"
        db.commit()

        asset_path = storage.path_for(job.uploaded_asset_key)
        if asset_path is None:
            raise RuntimeError("S3-backed upload analysis download is not implemented in local mode.")

        summary = analyze_video_file(asset_path)
        job.status = "completed"
        job.progress = 1.0
        job.completed_at = datetime.utcnow()
        job.message = "Analysis complete"

        result = AnalysisResult(
            id=generate_id("result"),
            job_id=job.id,
            recording_id=None,
            exercise=summary.exercise,
            confidence=summary.confidence,
            rep_count=summary.rep_count,
            overall_score=summary.overall_score,
            range_of_motion_score=summary.metrics["range_of_motion"],
            stability_score=summary.metrics["stability"],
            tempo_score=summary.metrics["tempo"],
            setup_score=summary.metrics["setup"],
            feedback=summary.feedback,
            cues=summary.cues,
        )
        db.add(result)
        db.flush()
        for index, rep_event in enumerate(summary.rep_events, start=1):
            db.add(
                RepEvent(
                    id=generate_id("rep"),
                    result_id=result.id,
                    rep_index=index,
                    timestamp_ms=int(rep_event["timestamp_ms"]),
                    quality_score=int(rep_event["quality_score"]),
                    notes=str(rep_event["notes"]),
                )
            )
        db.commit()
    except Exception as error:
        job = db.get(AnalysisJob, job_id)
        if job:
            job.status = "failed"
            job.message = str(error)
            job.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


@app.get(f"{settings.api_prefix}/analysis/jobs/{{job_id}}", response_model=AnalysisJobResponse)
def get_analysis_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(AnalysisJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job_payload(job)


@app.get(f"{settings.api_prefix}/analysis/jobs", response_model=AnalysisJobsListResponse)
def list_analysis_jobs(db: Session = Depends(get_db)):
    jobs = db.query(AnalysisJob).order_by(AnalysisJob.created_at.desc()).limit(25).all()
    return AnalysisJobsListResponse(jobs=[job_payload(job) for job in jobs])


@app.post(f"{settings.api_prefix}/upload")
async def upload_video_to_cdn(
    file: UploadFile = File(...),
    phone: str = Form("9999"),
):
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    if not settings.cloudinary_cloud_name:
        raise HTTPException(status_code=503, detail="Cloudinary not configured")

    content = await file.read()

    meta: dict = {
        "dateTime": int(time.time() * 1000),
        "exercise": "",
        "reps": 0,
        "form_score": 0.0,
        "feedback": {},
    }

    try:
        extension = Path(file.filename or "video.mp4").suffix or ".mp4"
        with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)

        try:
            summary = analyze_video_file(tmp_path)
            meta["exercise"] = summary.exercise
            meta["reps"] = summary.rep_count
            meta["form_score"] = round(summary.overall_score / 100, 2)
            meta["feedback"] = generate_ai_feedback(summary)
        finally:
            tmp_path.unlink(missing_ok=True)
    except Exception as exc:
        logger.warning("Video analysis failed, saving without summary: %s", exc)

    video_url = upload_to_cloudinary(content, file.filename or "video.mp4")

    supabase_client.table("userVedios").insert({
        "cdn_url": video_url,
        "phone_number": phone,
        "meta": meta,
    }).execute()

    return {
        "url": video_url,
        "phone": phone,
        "meta": meta,
    }


@app.get(f"{settings.api_prefix}/videos")
def get_videos_by_phone(phone: str = "9999"):
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    result = (
        supabase_client.table("userVedios")
        .select("*")
        .eq("phone_number", phone)
        .order("id", desc=True)
        .execute()
    )
    return result.data


@app.get(f"{settings.api_prefix}/assets/{{storage_key:path}}")
def get_asset(storage_key: str):
    asset_path = storage.path_for(storage_key)
    if asset_path is None or not asset_path.exists():
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(asset_path)


@app.websocket(f"{settings.api_prefix}/live-analysis/{{recording_id}}")
async def live_analysis_socket(
    websocket: WebSocket,
    recording_id: str,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    recording = db.get(Recording, recording_id)
    if not recording or recording.live_analysis_token != token:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    session = LivePoseAnalyzerSession(selected_exercise=recording.selected_exercise)

    try:
        while True:
            payload = await websocket.receive_text()
            message = json.loads(payload)
            frame_b64 = message.get("frame")
            timestamp_ms = int(message.get("timestampMs", 0))
            analysis_mode = str(message.get("analysisMode", "recording"))
            if not frame_b64:
                continue
            frame_bytes = base64.b64decode(frame_b64)
            image_array = np.frombuffer(frame_bytes, dtype=np.uint8)
            frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if frame is None:
                continue
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            summary = await session.analyze(rgb_frame, timestamp_ms, analysis_mode=analysis_mode)
            response = LiveAnalysisMessage(
                exercise=summary.exercise,
                selected_exercise=summary.selected_exercise,
                confidence=summary.confidence,
                rep_count=summary.rep_count,
                form_status=summary.form_status,
                cues=summary.cues,
                feedback_items=summary.feedback_items,
                checks=summary.checks,
                primary_cues=summary.primary_cues,
                guidance_confidence=summary.guidance_confidence,
                calibration_state=summary.calibration_state,
                rep_phase=summary.rep_phase,
                metrics=summary.metrics,
                pose_landmarks=summary.pose_landmarks,
                overlay_segments=summary.overlay_segments,
            )
            await websocket.send_json(response.model_dump())
    except WebSocketDisconnect:
        pass
    finally:
        session.close()

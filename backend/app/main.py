from __future__ import annotations

import asyncio
import base64
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, List, Optional

import cv2
import numpy as np
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .analysis_engine import LivePoseAnalyzerSession, analyze_video_file, generate_id
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

        recording.status = "ready"
        db.commit()
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
    recording.status = "processing"
    recording.upload_status = "complete"
    db.commit()

    background_tasks.add_task(run_recording_analysis_job, recording_id)
    return {"queued": True}


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

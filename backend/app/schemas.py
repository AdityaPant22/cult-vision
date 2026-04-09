from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Union

from pydantic import BaseModel, Field


class RecordingCreateRequest(BaseModel):
    device_id: str
    device_name: str
    zone_name: str
    user_id: str
    user_name: str
    selected_exercise: Optional[str] = None
    started_at: Optional[datetime] = None


class RecordingCreateResponse(BaseModel):
    recording_id: str
    upload_url: str
    live_analysis_ws_url: str
    live_analysis_token: str
    started_at: datetime


class UploadCompleteRequest(BaseModel):
    stopped_at: datetime
    duration_sec: int


class LiveAnalysisMessage(BaseModel):
    type: str = "live_analysis"
    exercise: str
    selected_exercise: Optional[str] = None
    confidence: float
    rep_count: int
    form_status: str
    cues: List[str]
    feedback_items: List[str] = Field(default_factory=list)
    checks: List[Dict[str, Union[float, int, str]]] = Field(default_factory=list)
    primary_cues: List[str] = Field(default_factory=list)
    guidance_confidence: float = 0.0
    calibration_state: str = "warming_up"
    rep_phase: str = "setup"
    metrics: Dict[str, int]
    pose_landmarks: List[Dict[str, Union[float, str]]] = Field(default_factory=list)
    overlay_segments: List[Dict[str, str]] = Field(default_factory=list)
    overlay_lines: List[Dict[str, Union[float, str]]] = Field(default_factory=list)
    squat_metrics: Dict[str, Union[float, bool, None]] = Field(default_factory=dict)


class RepEventPayload(BaseModel):
    rep_index: int
    timestamp_ms: int
    quality_score: int
    notes: str


class AnalysisResultPayload(BaseModel):
    exercise: str
    confidence: float
    rep_count: int
    overall_score: int
    metrics: Dict[str, int]
    feedback: List[str]
    cues: List[str]
    rep_events: List[RepEventPayload] = Field(default_factory=list)


class AnalysisJobResponse(BaseModel):
    job_id: str
    status: str
    progress: float
    message: str
    source_label: str
    result: Optional[AnalysisResultPayload] = None


class RecordingListItem(BaseModel):
    id: str
    user_name: str
    device_name: str
    zone_name: str
    started_at: datetime
    stopped_at: Optional[datetime]
    duration_sec: int
    status: str
    asset_url: Optional[str]
    mime_type: Optional[str]
    latest_result: Optional[AnalysisResultPayload] = None


class RecordingDeleteResponse(BaseModel):
    deleted: bool = True


class AnalysisJobsListResponse(BaseModel):
    jobs: List[AnalysisJobResponse]

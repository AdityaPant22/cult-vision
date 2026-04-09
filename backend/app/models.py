from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.utcnow()


class Recording(Base):
    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    device_id: Mapped[str] = mapped_column(String, index=True)
    device_name: Mapped[str] = mapped_column(String)
    zone_name: Mapped[str] = mapped_column(String)
    user_id: Mapped[str] = mapped_column(String, index=True)
    user_name: Mapped[str] = mapped_column(String)
    phone_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    selected_exercise: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    cloud_sync_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="created")
    upload_status: Mapped[str] = mapped_column(String, default="pending")
    live_analysis_token: Mapped[str] = mapped_column(String, index=True)
    storage_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    asset_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    analysis_jobs: Mapped[List["AnalysisJob"]] = relationship(
        back_populates="recording", cascade="all, delete-orphan"
    )
    latest_result: Mapped[Optional["AnalysisResult"]] = relationship(
        back_populates="recording",
        cascade="all, delete-orphan",
        uselist=False,
    )


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    recording_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), nullable=True
    )
    source_type: Mapped[str] = mapped_column(String)
    source_label: Mapped[str] = mapped_column(String)
    uploaded_asset_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    uploaded_asset_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    recording: Mapped[Optional["Recording"]] = relationship(back_populates="analysis_jobs")
    result: Mapped[Optional["AnalysisResult"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        uselist=False,
    )


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), unique=True
    )
    recording_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    exercise: Mapped[str] = mapped_column(String)
    confidence: Mapped[float] = mapped_column(Float)
    rep_count: Mapped[int] = mapped_column(Integer)
    overall_score: Mapped[int] = mapped_column(Integer)
    range_of_motion_score: Mapped[int] = mapped_column(Integer)
    stability_score: Mapped[int] = mapped_column(Integer)
    tempo_score: Mapped[int] = mapped_column(Integer)
    setup_score: Mapped[int] = mapped_column(Integer)
    feedback: Mapped[List[str]] = mapped_column(JSON)
    cues: Mapped[List[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    job: Mapped["AnalysisJob"] = relationship(back_populates="result")
    recording: Mapped[Optional["Recording"]] = relationship(back_populates="latest_result")
    rep_events: Mapped[List["RepEvent"]] = relationship(
        back_populates="result", cascade="all, delete-orphan"
    )


class RepEvent(Base):
    __tablename__ = "rep_events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    result_id: Mapped[str] = mapped_column(
        ForeignKey("analysis_results.id", ondelete="CASCADE")
    )
    rep_index: Mapped[int] = mapped_column(Integer)
    timestamp_ms: Mapped[int] = mapped_column(Integer)
    quality_score: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(String, default="")

    result: Mapped["AnalysisResult"] = relationship(back_populates="rep_events")

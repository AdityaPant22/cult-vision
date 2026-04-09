from __future__ import annotations

import asyncio
import math
import os
import urllib.request
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

RUNTIME_CACHE_DIR = Path(__file__).resolve().parents[2] / "backend" / "data" / "runtime-cache"
RUNTIME_CACHE_DIR.mkdir(parents=True, exist_ok=True)
MATPLOTLIB_CACHE_DIR = RUNTIME_CACHE_DIR / "matplotlib"
MATPLOTLIB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(MATPLOTLIB_CACHE_DIR))
os.environ.setdefault("XDG_CACHE_HOME", str(RUNTIME_CACHE_DIR))

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from .config import settings


POSE_NAMES = [
    "nose",
    "left_eye_inner",
    "left_eye",
    "left_eye_outer",
    "right_eye_inner",
    "right_eye",
    "right_eye_outer",
    "left_ear",
    "right_ear",
    "mouth_left",
    "mouth_right",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_pinky",
    "right_pinky",
    "left_index",
    "right_index",
    "left_thumb",
    "right_thumb",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
    "left_heel",
    "right_heel",
    "left_foot_index",
    "right_foot_index",
]

SUPPORTED_EXERCISES = {"Squat", "Push-up", "Lunge", "Bicep Curl"}


@dataclass
class PosePoint:
    x: float
    y: float
    z: float
    visibility: float


@dataclass
class FrameMetrics:
    torso_angle_from_horizontal: float | None
    average_knee_angle: float | None
    average_elbow_angle: float | None
    left_knee_angle: float | None
    right_knee_angle: float | None
    left_elbow_angle: float | None
    right_elbow_angle: float | None
    knee_asymmetry: float | None
    shoulder_drift: float | None
    vertical_displacement: float | None
    timestamp_ms: int


@dataclass
class ExerciseSummary:
    exercise: str
    confidence: float
    rep_count: int
    overall_score: int
    metrics: dict[str, int]
    feedback: list[str]
    cues: list[str]
    form_status: str
    rep_events: list[dict[str, int | str]]
    selected_exercise: str | None = None
    pose_landmarks: list[dict[str, float | str]] = field(default_factory=list)
    overlay_segments: list[dict[str, str]] = field(default_factory=list)
    overlay_lines: list[dict[str, float | str]] = field(default_factory=list)
    squat_metrics: dict[str, float | bool | None] = field(default_factory=dict)
    feedback_items: list[str] = field(default_factory=list)
    checks: list[dict[str, float | int | str]] = field(default_factory=list)
    primary_cues: list[str] = field(default_factory=list)
    guidance_confidence: float = 0.0
    calibration_state: str = "warming_up"
    rep_phase: str = "setup"


@dataclass
class LiveGuidanceCheck:
    id: str
    label: str
    status: str
    severity: int
    confidence: float
    phase: str
    message: str
    segments: list[tuple[str, str, str, str]] = field(default_factory=list)


@dataclass
class LiveCheckMemory:
    score: float = 0.0
    status: str = "ok"
    severity: int = 0
    confidence: float = 0.0
    phase: str = "setup"
    message: str = ""
    label: str = ""
    segments: list[tuple[str, str, str, str]] = field(default_factory=list)


@dataclass
class OverlayLine:
    id: str
    label: str
    kind: str
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass
class SquatMetricSnapshot:
    crotch_angle: float | None = None
    shoulder_width: float | None = None
    feet_width: float | None = None
    feet_width_ratio: float | None = None
    torso_vs_vertical_angle: float | None = None
    midfoot_bar_offset: float | None = None
    elbow_body_parallel_angle: float | None = None
    bar_center_detected: bool = False

    def as_payload(self) -> dict[str, float | bool | None]:
        return {
            "crotch_angle": round(self.crotch_angle, 1) if self.crotch_angle is not None else None,
            "shoulder_width": round(self.shoulder_width, 3) if self.shoulder_width is not None else None,
            "feet_width": round(self.feet_width, 3) if self.feet_width is not None else None,
            "feet_width_ratio": round(self.feet_width_ratio, 2) if self.feet_width_ratio is not None else None,
            "torso_vs_vertical_angle": round(self.torso_vs_vertical_angle, 1)
            if self.torso_vs_vertical_angle is not None
            else None,
            "midfoot_bar_offset": round(self.midfoot_bar_offset, 3)
            if self.midfoot_bar_offset is not None
            else None,
            "elbow_body_parallel_angle": round(self.elbow_body_parallel_angle, 1)
            if self.elbow_body_parallel_angle is not None
            else None,
            "bar_center_detected": self.bar_center_detected,
        }


@dataclass
class CalibrationProfile:
    observed_frames: int = 0
    visibility_samples: deque = field(default_factory=lambda: deque(maxlen=18))
    torso_angle_samples: deque = field(default_factory=lambda: deque(maxlen=18))
    limb_scale_samples: deque = field(default_factory=lambda: deque(maxlen=18))
    gravity_vector_samples: deque = field(default_factory=lambda: deque(maxlen=18))
    shoulder_width_samples: deque = field(default_factory=lambda: deque(maxlen=18))
    hip_center_samples: deque = field(default_factory=lambda: deque(maxlen=18))
    frozen_torso_angle: float | None = None
    frozen_limb_scale: float | None = None
    frozen_gravity_direction: tuple[float, float] | None = None
    frozen_shoulder_width: float | None = None
    frozen_hip_center: tuple[float, float] | None = None

    def observe(
        self,
        landmarks: dict[str, PosePoint],
        world_landmarks: dict[str, PosePoint],
        metrics: FrameMetrics,
        visibility_count: int,
    ) -> None:
        self.observed_frames += 1
        self.visibility_samples.append(visibility_count)

        if metrics.torso_angle_from_horizontal is not None:
            self.torso_angle_samples.append(metrics.torso_angle_from_horizontal)

        left_shoulder = maybe_point(landmarks, "left_shoulder")
        right_shoulder = maybe_point(landmarks, "right_shoulder")
        left_hip = maybe_point(landmarks, "left_hip")
        right_hip = maybe_point(landmarks, "right_hip")

        if left_shoulder and right_shoulder and left_hip and right_hip:
            shoulder_mid = midpoint(left_shoulder, right_shoulder)
            hip_mid = midpoint(left_hip, right_hip)
            torso_length = math.sqrt(
                (shoulder_mid.x - hip_mid.x) ** 2 + (shoulder_mid.y - hip_mid.y) ** 2
            )
            self.limb_scale_samples.append(torso_length * 100)
            gravity_vector = normalize_vector_2d(
                hip_mid.x - shoulder_mid.x,
                hip_mid.y - shoulder_mid.y,
            )
            if gravity_vector is not None:
                self.gravity_vector_samples.append(gravity_vector)
            self.hip_center_samples.append((hip_mid.x, hip_mid.y))

        world_left_shoulder = maybe_point(world_landmarks, "left_shoulder")
        world_right_shoulder = maybe_point(world_landmarks, "right_shoulder")
        if world_left_shoulder and world_right_shoulder:
            self.shoulder_width_samples.append(distance_3d(world_left_shoulder, world_right_shoulder))

    @property
    def neutral_torso_angle(self) -> float | None:
        if self.frozen_torso_angle is not None:
            return self.frozen_torso_angle
        values = list(self.torso_angle_samples)
        return average(values)

    @property
    def limb_scale(self) -> float | None:
        if self.frozen_limb_scale is not None:
            return self.frozen_limb_scale
        values = list(self.limb_scale_samples)
        return average(values)

    @property
    def gravity_direction(self) -> tuple[float, float] | None:
        if self.frozen_gravity_direction is not None:
            return self.frozen_gravity_direction
        return average_direction(list(self.gravity_vector_samples))

    @property
    def standing_shoulder_width(self) -> float | None:
        if self.frozen_shoulder_width is not None:
            return self.frozen_shoulder_width
        return average(list(self.shoulder_width_samples))

    @property
    def standing_hip_center(self) -> tuple[float, float] | None:
        if self.frozen_hip_center is not None:
            return self.frozen_hip_center
        return average_point_2d(list(self.hip_center_samples))

    @property
    def state(self) -> str:
        avg_visibility = average(list(self.visibility_samples)) or 0.0
        if self.observed_frames < 6:
            return "warming_up"
        if (
            avg_visibility < 10
            or self.neutral_torso_angle is None
            or self.limb_scale is None
            or self.gravity_direction is None
            or self.standing_shoulder_width is None
        ):
            return "weak"
        return "ready"

    @property
    def guidance_confidence(self) -> float:
        avg_visibility = average(list(self.visibility_samples)) or 0.0
        visibility_score = clamp((avg_visibility - 7) / 10, 0.18, 0.95)
        if self.state == "warming_up":
            return round(min(0.55, visibility_score), 2)
        if self.state == "weak":
            return round(min(0.48, visibility_score), 2)
        return round(max(0.68, visibility_score), 2)

    def freeze(self) -> None:
        if self.frozen_torso_angle is None:
            self.frozen_torso_angle = self.neutral_torso_angle
        if self.frozen_limb_scale is None:
            self.frozen_limb_scale = self.limb_scale
        if self.frozen_gravity_direction is None:
            self.frozen_gravity_direction = self.gravity_direction
        if self.frozen_shoulder_width is None:
            self.frozen_shoulder_width = self.standing_shoulder_width
        if self.frozen_hip_center is None:
            self.frozen_hip_center = self.standing_hip_center


def ensure_model_file() -> Path:
    target = settings.mediapipe_model_path
    if not target.exists():
      target.parent.mkdir(parents=True, exist_ok=True)
      urllib.request.urlretrieve(settings.mediapipe_model_url, target)
    return target


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(value, max_value))


def average(values: Iterable[float | None]) -> float | None:
    valid = [value for value in values if value is not None and math.isfinite(value)]
    if not valid:
        return None
    return sum(valid) / len(valid)


def stddev(values: Iterable[float | None]) -> float:
    valid = [value for value in values if value is not None and math.isfinite(value)]
    if len(valid) < 2:
        return 0.0
    mean = sum(valid) / len(valid)
    variance = sum((value - mean) ** 2 for value in valid) / (len(valid) - 1)
    return math.sqrt(variance)


def angle_at_point(a: PosePoint, b: PosePoint, c: PosePoint) -> float:
    abx = a.x - b.x
    aby = a.y - b.y
    cbx = c.x - b.x
    cby = c.y - b.y
    dot = abx * cbx + aby * cby
    magnitude = math.sqrt(abx**2 + aby**2) * math.sqrt(cbx**2 + cby**2)
    if magnitude == 0:
        return 180.0
    cosine = clamp(dot / magnitude, -1.0, 1.0)
    return math.degrees(math.acos(cosine))


def midpoint(a: PosePoint, b: PosePoint) -> PosePoint:
    return PosePoint(
        x=(a.x + b.x) / 2,
        y=(a.y + b.y) / 2,
        z=(a.z + b.z) / 2,
        visibility=min(a.visibility, b.visibility),
    )


def average_point_2d(points: Iterable[tuple[float, float] | None]) -> tuple[float, float] | None:
    valid = [point for point in points if point is not None]
    if not valid:
        return None
    sum_x = sum(point[0] for point in valid)
    sum_y = sum(point[1] for point in valid)
    return (sum_x / len(valid), sum_y / len(valid))


def normalize_vector_2d(dx: float, dy: float) -> tuple[float, float] | None:
    magnitude = math.sqrt(dx**2 + dy**2)
    if magnitude == 0:
        return None
    return (dx / magnitude, dy / magnitude)


def average_direction(vectors: Iterable[tuple[float, float] | None]) -> tuple[float, float] | None:
    valid = [vector for vector in vectors if vector is not None]
    if not valid:
        return None
    avg_dx = sum(vector[0] for vector in valid) / len(valid)
    avg_dy = sum(vector[1] for vector in valid) / len(valid)
    return normalize_vector_2d(avg_dx, avg_dy)


def distance_3d(a: PosePoint, b: PosePoint) -> float:
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def distance_xz(a: PosePoint, b: PosePoint) -> float:
    return math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2)


def vector_between(a: PosePoint, b: PosePoint) -> tuple[float, float, float]:
    return (b.x - a.x, b.y - a.y, b.z - a.z)


def vector_length_3d(vector: tuple[float, float, float]) -> float:
    return math.sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2)


def normalize_vector_3d(vector: tuple[float, float, float]) -> tuple[float, float, float] | None:
    magnitude = vector_length_3d(vector)
    if magnitude == 0:
        return None
    return (vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude)


def angle_between_vectors(
    first: tuple[float, float, float],
    second: tuple[float, float, float],
) -> float | None:
    first_norm = normalize_vector_3d(first)
    second_norm = normalize_vector_3d(second)
    if first_norm is None or second_norm is None:
        return None
    dot = (
        first_norm[0] * second_norm[0]
        + first_norm[1] * second_norm[1]
        + first_norm[2] * second_norm[2]
    )
    return math.degrees(math.acos(clamp(dot, -1.0, 1.0)))


def project_to_plane(
    vector: tuple[float, float, float],
    normal: tuple[float, float, float],
) -> tuple[float, float, float]:
    normal_norm = normalize_vector_3d(normal)
    if normal_norm is None:
        return vector
    dot = (
        vector[0] * normal_norm[0]
        + vector[1] * normal_norm[1]
        + vector[2] * normal_norm[2]
    )
    return (
        vector[0] - dot * normal_norm[0],
        vector[1] - dot * normal_norm[1],
        vector[2] - dot * normal_norm[2],
    )


def clamp01(value: float) -> float:
    return clamp(value, 0.0, 1.0)


def build_centered_line(
    center: tuple[float, float],
    direction: tuple[float, float] | None,
    half_length: float,
) -> tuple[float, float, float, float] | None:
    if direction is None:
        return None
    norm = normalize_vector_2d(direction[0], direction[1])
    if norm is None:
        return None
    return (
        clamp01(center[0] - norm[0] * half_length),
        clamp01(center[1] - norm[1] * half_length),
        clamp01(center[0] + norm[0] * half_length),
        clamp01(center[1] + norm[1] * half_length),
    )


def build_directed_line(
    start: tuple[float, float],
    direction: tuple[float, float] | None,
    length: float,
) -> tuple[float, float, float, float] | None:
    if direction is None:
        return None
    norm = normalize_vector_2d(direction[0], direction[1])
    if norm is None:
        return None
    return (
        clamp01(start[0]),
        clamp01(start[1]),
        clamp01(start[0] + norm[0] * length),
        clamp01(start[1] + norm[1] * length),
    )


def angle_between_vectors_2d(
    first: tuple[float, float],
    second: tuple[float, float],
    acute: bool = False,
) -> float | None:
    first_norm = normalize_vector_2d(first[0], first[1])
    second_norm = normalize_vector_2d(second[0], second[1])
    if first_norm is None or second_norm is None:
        return None
    dot = first_norm[0] * second_norm[0] + first_norm[1] * second_norm[1]
    if acute:
        dot = abs(dot)
    return math.degrees(math.acos(clamp(dot, -1.0, 1.0)))


def overlay_line_payload(line: OverlayLine) -> dict[str, float | str]:
    return {
        "id": line.id,
        "label": line.label,
        "kind": line.kind,
        "x1": round(line.x1, 4),
        "y1": round(line.y1, 4),
        "x2": round(line.x2, 4),
        "y2": round(line.y2, 4),
    }


def maybe_point(landmarks: dict[str, PosePoint], name: str) -> PosePoint | None:
    point = landmarks.get(name)
    if not point or point.visibility < 0.35:
        return None
    return point


def metrics_from_landmarks(
    landmarks: dict[str, PosePoint], timestamp_ms: int
) -> FrameMetrics:
    left_shoulder = maybe_point(landmarks, "left_shoulder")
    right_shoulder = maybe_point(landmarks, "right_shoulder")
    left_hip = maybe_point(landmarks, "left_hip")
    right_hip = maybe_point(landmarks, "right_hip")
    left_knee = maybe_point(landmarks, "left_knee")
    right_knee = maybe_point(landmarks, "right_knee")
    left_ankle = maybe_point(landmarks, "left_ankle")
    right_ankle = maybe_point(landmarks, "right_ankle")
    left_elbow = maybe_point(landmarks, "left_elbow")
    right_elbow = maybe_point(landmarks, "right_elbow")
    left_wrist = maybe_point(landmarks, "left_wrist")
    right_wrist = maybe_point(landmarks, "right_wrist")

    torso_angle = None
    shoulder_drift = None
    vertical_displacement = None
    if left_shoulder and right_shoulder and left_hip and right_hip:
        shoulder_mid = midpoint(left_shoulder, right_shoulder)
        hip_mid = midpoint(left_hip, right_hip)
        torso_angle = math.degrees(
            abs(math.atan2(hip_mid.y - shoulder_mid.y, hip_mid.x - shoulder_mid.x))
        )
        shoulder_drift = abs(left_shoulder.y - right_shoulder.y) * 100
        vertical_displacement = abs(hip_mid.y - shoulder_mid.y) * 100

    left_knee_angle = (
        angle_at_point(left_hip, left_knee, left_ankle)
        if left_hip and left_knee and left_ankle
        else None
    )
    right_knee_angle = (
        angle_at_point(right_hip, right_knee, right_ankle)
        if right_hip and right_knee and right_ankle
        else None
    )
    left_elbow_angle = (
        angle_at_point(left_shoulder, left_elbow, left_wrist)
        if left_shoulder and left_elbow and left_wrist
        else None
    )
    right_elbow_angle = (
        angle_at_point(right_shoulder, right_elbow, right_wrist)
        if right_shoulder and right_elbow and right_wrist
        else None
    )

    return FrameMetrics(
        torso_angle_from_horizontal=torso_angle,
        average_knee_angle=average([left_knee_angle, right_knee_angle]),
        average_elbow_angle=average([left_elbow_angle, right_elbow_angle]),
        left_knee_angle=left_knee_angle,
        right_knee_angle=right_knee_angle,
        left_elbow_angle=left_elbow_angle,
        right_elbow_angle=right_elbow_angle,
        knee_asymmetry=
        abs(left_knee_angle - right_knee_angle)
        if left_knee_angle is not None and right_knee_angle is not None
        else None,
        shoulder_drift=shoulder_drift,
        vertical_displacement=vertical_displacement,
        timestamp_ms=timestamp_ms,
    )


def count_reps(
    values: list[float | None],
    timestamps: list[int],
    low: float,
    high: float,
    count_on: str = "high",
) -> tuple[int, list[int]]:
    first_valid = next((value for value in values if value is not None), None)
    if first_valid is None:
        return 0, []

    midpoint = (low + high) / 2
    state = "down" if first_valid < midpoint else "up"
    reps = 0
    rep_timestamps: list[int] = []
    for index, value in enumerate(values):
        if value is None:
            continue
        if state == "up" and value < low:
            if count_on == "low":
                reps += 1
                rep_timestamps.append(timestamps[index])
            state = "down"
        elif state == "down" and value > high:
            if count_on == "high":
                reps += 1
                rep_timestamps.append(timestamps[index])
            state = "up"
    return reps, rep_timestamps


def score_range(min_angle: float | None, target_low: float, target_high: float) -> int:
    if min_angle is None:
        return 30
    if min_angle <= target_low:
        return 95
    if min_angle >= target_high:
        return 35
    ratio = (target_high - min_angle) / (target_high - target_low)
    return round(35 + ratio * 60)


def score_stability(std: float, ideal_max: float, poor_max: float) -> int:
    if std <= ideal_max:
        return 92
    if std >= poor_max:
        return 40
    ratio = (poor_max - std) / (poor_max - ideal_max)
    return round(40 + ratio * 52)


def score_tempo(rep_count: int, signal_std: float) -> int:
    if rep_count <= 0:
        return 45
    if rep_count == 1:
        return 68
    return int(clamp(round(88 - signal_std / 2), 55, 92))


def score_setup(visibility_count: int) -> int:
    return int(clamp(40 + visibility_count * 2, 45, 95))


def amplitude(values: list[float | None]) -> float:
    valid = [value for value in values if value is not None]
    if not valid:
        return 0.0
    return max(valid) - min(valid)


def choose_dominant_signal(
    left_values: list[float | None], right_values: list[float | None]
) -> tuple[list[float | None], str, float]:
    left_amplitude = amplitude(left_values)
    right_amplitude = amplitude(right_values)

    if left_amplitude >= right_amplitude:
        return left_values, "left", left_amplitude

    return right_values, "right", right_amplitude


def normalize_selected_exercise(value: str | None) -> str | None:
    if value in SUPPORTED_EXERCISES:
        return value
    return None


def current_signal_and_delta(values: list[float | None]) -> tuple[float | None, float]:
    valid = [value for value in values if value is not None]
    if not valid:
        return None, 0.0
    current = valid[-1]
    previous = valid[-2] if len(valid) > 1 else current
    return current, current - previous


def infer_rep_phase(
    values: list[float | None],
    low: float,
    high: float,
    count_on: str = "high",
) -> str:
    current, delta = current_signal_and_delta(values)
    if current is None:
        return "setup"

    if count_on == "low":
        if current >= high - 6 and abs(delta) < 2:
            return "setup"
        if delta < 0:
            return "curling"
        return "return"

    if current >= high - 6 and abs(delta) < 2:
        return "setup"
    if delta < 0:
        return "lowering"
    return "driving"


def side_name_prefix(side: str) -> str:
    return "left" if side == "left" else "right"


def scaled_offset_threshold(base: float, calibration: CalibrationProfile) -> float:
    limb_scale = calibration.limb_scale or 24.0
    return base * clamp(limb_scale / 24.0, 0.8, 1.35)


def make_guidance_check(
    check_id: str,
    label: str,
    should_warn: bool,
    severity: int,
    confidence: float,
    phase: str,
    message: str,
    segments: list[tuple[str, str, str, str]],
) -> LiveGuidanceCheck:
    return LiveGuidanceCheck(
        id=check_id,
        label=label,
        status="warn" if should_warn else "ok",
        severity=int(clamp(severity, 0, 100)),
        confidence=round(clamp(confidence, 0.0, 1.0), 2),
        phase=phase,
        message=message,
        segments=segments,
    )


def countdown_guidance_message(calibration: CalibrationProfile) -> list[str]:
    if calibration.state == "warming_up":
        return ["Calibrating framing for live coaching..."]
    if calibration.state == "weak":
        return ["Move back so your full body stays visible before the set starts."]
    return ["Framing looks ready. Hold your setup for the countdown."]


def build_feedback(
    exercise: str,
    range_score: int,
    stability_score: int,
    tempo_score: int,
    setup_score: int,
    rep_count: int,
) -> tuple[list[str], list[str], str]:
    feedback: list[str] = []
    cues: list[str] = []

    if rep_count == 0:
        feedback.append("Could not confidently count reps. Use a clearer side angle.")
    if range_score < 65:
        if exercise == "Squat":
            feedback.append("Go deeper to improve squat depth.")
            cues.append("Go deeper")
        elif exercise == "Push-up":
            feedback.append("Lower further to increase elbow bend.")
            cues.append("Lower further")
        elif exercise == "Lunge":
            feedback.append("Sink lower so the front leg reaches fuller depth.")
            cues.append("Sink lower")
        elif exercise == "Bicep Curl":
            feedback.append("Curl higher to reach fuller elbow flexion.")
            cues.append("Curl higher")
    if stability_score < 65:
        if exercise == "Bicep Curl":
            feedback.append("Movement looked unstable. Keep your upper arm steadier.")
            cues.append("Keep elbow steady")
        else:
            feedback.append("Movement looked unstable. Keep the camera fixed and body centered.")
            cues.append("Stay stable")
    if tempo_score < 65:
        feedback.append("Rep tempo looked inconsistent. Try a steadier rhythm.")
        cues.append("Keep steady tempo")
    if setup_score < 65:
        feedback.append("Setup quality was weak. Keep your full body in frame.")
        cues.append("Keep full body in frame")
    if not feedback:
        feedback.append("Solid baseline rep quality.")
        cues.append("Good form")

    overall_indicator = (
        "good"
        if range_score >= 75 and stability_score >= 75 and tempo_score >= 70
        else "needs_work"
    )
    return feedback[:3], cues[:2], overall_indicator


def detect_exercise(metrics: list[FrameMetrics]) -> str:
    torso_angles = [item.torso_angle_from_horizontal for item in metrics]
    knee_angles = [item.average_knee_angle for item in metrics]
    elbow_angles = [item.average_elbow_angle for item in metrics]
    left_knee_angles = [item.left_knee_angle for item in metrics]
    right_knee_angles = [item.right_knee_angle for item in metrics]
    left_elbow_angles = [item.left_elbow_angle for item in metrics]
    right_elbow_angles = [item.right_elbow_angle for item in metrics]
    asymmetry_values = [item.knee_asymmetry for item in metrics]
    shoulder_drift_values = [item.shoulder_drift for item in metrics]
    timestamps = [item.timestamp_ms for item in metrics]

    torso_mean = average(torso_angles) or 90.0
    valid_knees = [value for value in knee_angles if value is not None]
    valid_elbows = [value for value in elbow_angles if value is not None]
    knee_amplitude = (max(valid_knees) - min(valid_knees)) if valid_knees else 0.0
    elbow_amplitude = (max(valid_elbows) - min(valid_elbows)) if valid_elbows else 0.0
    asymmetry_mean = average(asymmetry_values) or 0.0
    dominant_elbow_signal, dominant_elbow_side, dominant_elbow_amplitude = choose_dominant_signal(
        left_elbow_angles, right_elbow_angles
    )
    dominant_knee_amplitude = max(amplitude(left_knee_angles), amplitude(right_knee_angles))

    if torso_mean < 35 and elbow_amplitude > 35:
        return "Push-up"
    if knee_amplitude > 35 and asymmetry_mean < 20:
        return "Squat"
    if knee_amplitude > 25 and asymmetry_mean >= 20:
        return "Lunge"
    if (
        torso_mean > 55
        and dominant_elbow_amplitude > 30
        and dominant_elbow_amplitude > dominant_knee_amplitude + 15
        and dominant_knee_amplitude < 20
    ):
        return "Bicep Curl"
    return "Unknown"


def summarize_unknown_metrics(
    metrics: list[FrameMetrics], visibility_count: int
) -> ExerciseSummary:
    knee_angles = [item.average_knee_angle for item in metrics]
    timestamps = [item.timestamp_ms for item in metrics]
    shoulder_drift_values = [item.shoulder_drift for item in metrics]
    rep_count, rep_timestamps = count_reps(knee_angles, timestamps, 110, 160)
    stability_score = score_stability(stddev(shoulder_drift_values), 6, 24)
    tempo_score = score_tempo(rep_count, stddev(knee_angles))
    setup_score = score_setup(visibility_count)
    overall_score = round(45 * 0.35 + stability_score * 0.25 + tempo_score * 0.2 + setup_score * 0.2)
    feedback = ["We could not confidently identify the exercise. Use a clearer side angle."]
    cues = ["Use a clear side angle", "Keep full body in frame"]
    rep_events = [
        {
            "timestamp_ms": timestamp_ms,
            "quality_score": int(clamp(round((overall_score + 45) / 2), 40, 95)),
            "notes": feedback[0],
        }
        for timestamp_ms in rep_timestamps
    ]

    return ExerciseSummary(
        exercise="Unknown",
        confidence=0.35,
        rep_count=rep_count,
        overall_score=overall_score,
        metrics={
            "range_of_motion": 45,
            "stability": stability_score,
            "tempo": tempo_score,
            "setup": setup_score,
        },
        feedback=feedback,
        cues=cues,
        form_status="needs_work",
        rep_events=rep_events,
    )


def summarize_for_exercise(
    exercise: str,
    metrics: list[FrameMetrics],
    visibility_count: int,
    selected_exercise: str | None = None,
) -> ExerciseSummary:
    knee_angles = [item.average_knee_angle for item in metrics]
    elbow_angles = [item.average_elbow_angle for item in metrics]
    left_knee_angles = [item.left_knee_angle for item in metrics]
    right_knee_angles = [item.right_knee_angle for item in metrics]
    left_elbow_angles = [item.left_elbow_angle for item in metrics]
    right_elbow_angles = [item.right_elbow_angle for item in metrics]
    shoulder_drift_values = [item.shoulder_drift for item in metrics]
    timestamps = [item.timestamp_ms for item in metrics]

    valid_knees = [value for value in knee_angles if value is not None]
    valid_elbows = [value for value in elbow_angles if value is not None]
    knee_amplitude = (max(valid_knees) - min(valid_knees)) if valid_knees else 0.0
    elbow_amplitude = (max(valid_elbows) - min(valid_elbows)) if valid_elbows else 0.0
    dominant_elbow_signal, dominant_elbow_side, dominant_elbow_amplitude = choose_dominant_signal(
        left_elbow_angles, right_elbow_angles
    )
    dominant_elbow_valid = [value for value in dominant_elbow_signal if value is not None]

    rep_signal: list[float | None]
    rep_count = 0
    rep_timestamps: list[int] = []
    range_score = 45

    if exercise == "Push-up":
        rep_signal = elbow_angles
        rep_count, rep_timestamps = count_reps(elbow_angles, timestamps, 95, 155)
        min_angle = min(valid_elbows) if valid_elbows else None
        range_score = score_range(min_angle, 90, 135)
    elif exercise == "Squat":
        rep_signal = knee_angles
        rep_count, rep_timestamps = count_reps(knee_angles, timestamps, 110, 160)
        min_angle = min(valid_knees) if valid_knees else None
        range_score = score_range(min_angle, 95, 135)
    elif exercise == "Lunge":
        rep_signal = knee_angles
        rep_count, rep_timestamps = count_reps(knee_angles, timestamps, 115, 160)
        min_angle = min(valid_knees) if valid_knees else None
        range_score = score_range(min_angle, 100, 140)
    elif exercise == "Bicep Curl":
        rep_signal = dominant_elbow_signal
        rep_count, rep_timestamps = count_reps(
            dominant_elbow_signal,
            timestamps,
            70,
            140,
            count_on="low",
        )
        min_angle = min(dominant_elbow_valid) if dominant_elbow_valid else None
        range_score = score_range(min_angle, 65, 110)
    else:
        return summarize_unknown_metrics(metrics, visibility_count)

    stability_score = score_stability(stddev(shoulder_drift_values), 6, 24)
    tempo_score = score_tempo(rep_count, stddev(rep_signal))
    setup_score = score_setup(visibility_count)
    overall_score = round(
        range_score * 0.35
        + stability_score * 0.25
        + tempo_score * 0.2
        + setup_score * 0.2
    )
    confidence = float(
        clamp(
            (
                48
                + max(
                    knee_amplitude,
                    elbow_amplitude,
                    dominant_elbow_amplitude,
                )
                + visibility_count / 3
            )
            / 100,
            0.45,
            0.95,
        )
    )
    feedback, cues, form_status = build_feedback(
        exercise, range_score, stability_score, tempo_score, setup_score, rep_count
    )

    rep_events = [
        {
            "timestamp_ms": timestamp_ms,
            "quality_score": int(clamp(round((overall_score + range_score) / 2), 40, 95)),
            "notes": feedback[0],
        }
        for timestamp_ms in rep_timestamps
    ]

    final_cues = cues[:2]
    if exercise == "Bicep Curl" and rep_count > 0:
        final_cues = [f"Focus on the {dominant_elbow_side} arm", *final_cues][:2]

    return ExerciseSummary(
        exercise=exercise,
        confidence=confidence,
        rep_count=rep_count,
        overall_score=overall_score,
        metrics={
            "range_of_motion": range_score,
            "stability": stability_score,
            "tempo": tempo_score,
            "setup": setup_score,
        },
        feedback=feedback,
        cues=final_cues,
        form_status=form_status,
        rep_events=rep_events,
        selected_exercise=selected_exercise,
    )


def summarize_metrics(
    metrics: list[FrameMetrics],
    visibility_count: int,
    selected_exercise: str | None = None,
) -> ExerciseSummary:
    normalized_selected_exercise = normalize_selected_exercise(selected_exercise)
    if normalized_selected_exercise:
        return summarize_for_exercise(
            normalized_selected_exercise,
            metrics,
            visibility_count,
            selected_exercise=normalized_selected_exercise,
        )

    detected_exercise = detect_exercise(metrics)
    if detected_exercise == "Unknown":
        return summarize_unknown_metrics(metrics, visibility_count)
    return summarize_for_exercise(detected_exercise, metrics, visibility_count)


def serialize_pose_landmarks(landmarks: dict[str, PosePoint]) -> list[dict[str, float | str]]:
    return [
        {
            "name": name,
            "x": point.x,
            "y": point.y,
            "visibility": point.visibility,
        }
        for name in POSE_NAMES
        if (point := landmarks.get(name)) is not None
    ]


def pick_visible_side(
    landmarks: dict[str, PosePoint],
    landmark_names: tuple[str, ...] = ("shoulder", "elbow", "wrist"),
) -> str:
    side_scores: dict[str, float] = {"left": 0.0, "right": 0.0}
    for side in ("left", "right"):
        for name in landmark_names:
            point = landmarks.get(f"{side}_{name}")
            if point is not None:
                side_scores[side] += point.visibility
    return "left" if side_scores["left"] >= side_scores["right"] else "right"


def compute_squat_crotch_angle(world_landmarks: dict[str, PosePoint]) -> float | None:
    left_hip = maybe_point(world_landmarks, "left_hip")
    right_hip = maybe_point(world_landmarks, "right_hip")
    left_knee = maybe_point(world_landmarks, "left_knee")
    right_knee = maybe_point(world_landmarks, "right_knee")
    left_shoulder = maybe_point(world_landmarks, "left_shoulder")
    right_shoulder = maybe_point(world_landmarks, "right_shoulder")

    if not all([left_hip, right_hip, left_knee, right_knee, left_shoulder, right_shoulder]):
        return None

    pelvis_center = midpoint(left_hip, right_hip)
    shoulder_mid = midpoint(left_shoulder, right_shoulder)
    lateral_axis = vector_between(left_hip, right_hip)
    vertical_axis = vector_between(pelvis_center, shoulder_mid)
    frontal_normal = (
        lateral_axis[1] * vertical_axis[2] - lateral_axis[2] * vertical_axis[1],
        lateral_axis[2] * vertical_axis[0] - lateral_axis[0] * vertical_axis[2],
        lateral_axis[0] * vertical_axis[1] - lateral_axis[1] * vertical_axis[0],
    )

    left_vector = project_to_plane(vector_between(pelvis_center, left_knee), frontal_normal)
    right_vector = project_to_plane(vector_between(pelvis_center, right_knee), frontal_normal)
    return angle_between_vectors(left_vector, right_vector)


def detect_barbell_end_center(
    image_rgb: np.ndarray,
    landmarks: dict[str, PosePoint],
    preferred_side: str,
) -> tuple[float, float] | None:
    frame_height, frame_width = image_rgb.shape[:2]
    shoulder = maybe_point(landmarks, f"{preferred_side}_shoulder")
    wrist = maybe_point(landmarks, f"{preferred_side}_wrist")
    elbow = maybe_point(landmarks, f"{preferred_side}_elbow")

    anchor = shoulder or wrist or elbow
    if anchor is None:
        return None

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (9, 9), 1.4)

    shoulder_x = int((shoulder.x if shoulder else anchor.x) * frame_width)
    shoulder_y = int((shoulder.y if shoulder else anchor.y) * frame_height)
    wrist_x = int((wrist.x if wrist else anchor.x) * frame_width)
    lateral_anchor_x = shoulder_x if shoulder is not None else wrist_x

    if preferred_side == "left":
        roi_left = 0
        roi_right = min(frame_width, lateral_anchor_x + int(frame_width * 0.12))
    else:
        roi_left = max(0, lateral_anchor_x - int(frame_width * 0.12))
        roi_right = frame_width

    roi_top = max(0, shoulder_y - int(frame_height * 0.22))
    roi_bottom = min(frame_height, shoulder_y + int(frame_height * 0.2))
    if roi_right - roi_left < 32 or roi_bottom - roi_top < 32:
        return None

    roi_gray = gray[roi_top:roi_bottom, roi_left:roi_right]
    circles = cv2.HoughCircles(
        roi_gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=max(24, int(min(roi_gray.shape[:2]) * 0.22)),
        param1=110,
        param2=22,
        minRadius=max(10, int(min(roi_gray.shape[:2]) * 0.08)),
        maxRadius=max(18, int(min(roi_gray.shape[:2]) * 0.42)),
    )
    if circles is None:
        return None

    best_score = -1.0
    best_center: tuple[float, float] | None = None
    anchor_x = anchor.x * frame_width
    anchor_y = anchor.y * frame_height
    expected_direction = -1 if preferred_side == "left" else 1

    for cx, cy, radius in np.round(circles[0]).astype(int):
        absolute_x = roi_left + cx
        absolute_y = roi_top + cy
        direction_score = (absolute_x - anchor_x) * expected_direction
        vertical_gap = abs(absolute_y - anchor_y)
        score = radius * 2.4 + max(0.0, direction_score) * 0.32 - vertical_gap * 0.16
        if score > best_score:
            best_score = score
            best_center = (absolute_x / frame_width, absolute_y / frame_height)

    return best_center


def positive_guidance_message(exercise: str) -> str:
    if exercise == "Squat":
        return "Looks good. Keep driving evenly."
    if exercise == "Push-up":
        return "Looks good. Stay long through the body."
    if exercise == "Lunge":
        return "Looks good. Stay balanced through the split stance."
    if exercise == "Bicep Curl":
        return "Looks good. Keep the elbow tucked."
    return "Looks good. Keep going."


def recent_valid(values: list[float | None], count: int = 6) -> list[float]:
    return [value for value in values[-count:] if value is not None]


def build_live_checks(
    exercise: str | None,
    landmarks: dict[str, PosePoint],
    history: list[FrameMetrics],
    visibility_count: int,
    calibration: CalibrationProfile,
) -> tuple[list[LiveGuidanceCheck], str]:
    if not exercise or exercise not in SUPPORTED_EXERCISES or not history:
        return [], "setup"

    current_metrics = history[-1]
    base_confidence = clamp(0.45 + visibility_count / 28, 0.45, 0.92)
    checks: list[LiveGuidanceCheck] = []

    if exercise == "Squat":
        knee_signal = [item.average_knee_angle for item in history]
        rep_phase = infer_rep_phase(knee_signal, 110, 160)
        knee_angle = current_metrics.average_knee_angle
        knee_asymmetry = current_metrics.knee_asymmetry or 0.0
        recent_drift = average([item.shoulder_drift for item in history[-5:]]) or 0.0
        torso_reference = calibration.neutral_torso_angle or 78.0
        torso_threshold = max(62.0, torso_reference - 12.0)
        torso_gap = max(0.0, torso_threshold - (current_metrics.torso_angle_from_horizontal or torso_threshold))
        depth_gap = max(0.0, (knee_angle or 0.0) - 138.0)
        control_threshold = scaled_offset_threshold(7.0, calibration)

        checks.append(
            make_guidance_check(
                "squat-torso",
                "Torso",
                rep_phase != "setup"
                and current_metrics.torso_angle_from_horizontal is not None
                and current_metrics.torso_angle_from_horizontal < torso_threshold,
                48 + int(torso_gap * 3),
                base_confidence + min(0.15, torso_gap / 40),
                rep_phase,
                "Keep chest taller through the rep.",
                [
                    ("torso-left", "left_shoulder", "left_hip", "Torso"),
                    ("torso-right", "right_shoulder", "right_hip", "Torso"),
                ],
            )
        )
        checks.append(
            make_guidance_check(
                "squat-depth",
                "Depth",
                rep_phase in {"lowering", "driving"} and knee_angle is not None and knee_angle > 138,
                50 + int(depth_gap * 2),
                base_confidence + min(0.18, depth_gap / 55),
                rep_phase,
                "Sit a bit deeper before standing up.",
                [
                    ("left-thigh", "left_hip", "left_knee", "Left leg"),
                    ("left-shin", "left_knee", "left_ankle", "Left leg"),
                    ("right-thigh", "right_hip", "right_knee", "Right leg"),
                    ("right-shin", "right_knee", "right_ankle", "Right leg"),
                ],
            )
        )
        checks.append(
            make_guidance_check(
                "squat-symmetry",
                "Symmetry",
                rep_phase in {"lowering", "driving"} and knee_asymmetry > 16,
                44 + int(knee_asymmetry * 2),
                base_confidence + min(0.15, knee_asymmetry / 35),
                rep_phase,
                "Drive both knees evenly.",
                [
                    ("left-thigh", "left_hip", "left_knee", "Left leg"),
                    ("right-thigh", "right_hip", "right_knee", "Right leg"),
                ],
            )
        )
        checks.append(
            make_guidance_check(
                "squat-control",
                "Bottom control",
                rep_phase == "driving"
                and (min(recent_valid(knee_signal, 5)) if recent_valid(knee_signal, 5) else 180) < 138
                and recent_drift > control_threshold,
                42 + int(recent_drift * 2),
                base_confidence + min(0.1, recent_drift / 35),
                rep_phase,
                "Own the bottom before driving back up.",
                [
                    ("torso-left", "left_shoulder", "left_hip", "Torso"),
                    ("torso-right", "right_shoulder", "right_hip", "Torso"),
                ],
            )
        )
        return checks, rep_phase

    if exercise == "Push-up":
        elbow_signal = [item.average_elbow_angle for item in history]
        rep_phase = infer_rep_phase(elbow_signal, 95, 155)
        current_elbow = current_metrics.average_elbow_angle
        body_line_angles = []
        wrist_offsets = []
        for side in ("left", "right"):
            shoulder = maybe_point(landmarks, f"{side}_shoulder")
            hip = maybe_point(landmarks, f"{side}_hip")
            ankle = maybe_point(landmarks, f"{side}_ankle")
            wrist = maybe_point(landmarks, f"{side}_wrist")
            if shoulder and hip and ankle:
                body_line_angles.append(angle_at_point(shoulder, hip, ankle))
            if shoulder and wrist:
                wrist_offsets.append(abs(shoulder.x - wrist.x) * 100)

        body_line_angle = average(body_line_angles) or 170.0
        body_line_gap = max(0.0, 158.0 - body_line_angle)
        depth_gap = max(0.0, (current_elbow or 0.0) - 120.0)
        wrist_offset = average(wrist_offsets) or 0.0
        wrist_threshold = scaled_offset_threshold(18.0, calibration)
        control_drift = average([item.shoulder_drift for item in history[-5:]]) or 0.0

        arm_segments = [
            ("left-arm-upper", "left_shoulder", "left_elbow", "Left arm"),
            ("left-arm-lower", "left_elbow", "left_wrist", "Left arm"),
            ("right-arm-upper", "right_shoulder", "right_elbow", "Right arm"),
            ("right-arm-lower", "right_elbow", "right_wrist", "Right arm"),
        ]
        body_segments = [
            ("left-body-line", "left_shoulder", "left_hip", "Body line"),
            ("right-body-line", "right_shoulder", "right_hip", "Body line"),
        ]

        checks.append(
            make_guidance_check(
                "pushup-body-line",
                "Body line",
                rep_phase != "setup" and body_line_angle < 158,
                48 + int(body_line_gap * 3),
                base_confidence + min(0.12, body_line_gap / 30),
                rep_phase,
                "Keep hips and shoulders in one line.",
                body_segments,
            )
        )
        checks.append(
            make_guidance_check(
                "pushup-depth",
                "Depth",
                rep_phase in {"lowering", "driving"} and current_elbow is not None and current_elbow > 120,
                50 + int(depth_gap * 2),
                base_confidence + min(0.16, depth_gap / 45),
                rep_phase,
                "Lower a little deeper before driving up.",
                arm_segments,
            )
        )
        checks.append(
            make_guidance_check(
                "pushup-stack",
                "Shoulder stack",
                rep_phase != "setup" and wrist_offset > wrist_threshold,
                44 + int(max(0.0, wrist_offset - wrist_threshold) * 2),
                base_confidence + min(0.12, wrist_offset / 35),
                rep_phase,
                "Stack wrists more directly under the shoulders.",
                arm_segments,
            )
        )
        checks.append(
            make_guidance_check(
                "pushup-control",
                "Bottom control",
                rep_phase == "driving" and current_elbow is not None and current_elbow < 118 and control_drift > scaled_offset_threshold(7.0, calibration),
                42 + int(control_drift * 2),
                base_confidence + min(0.1, control_drift / 30),
                rep_phase,
                "Control the bottom before pressing away.",
                body_segments + arm_segments,
            )
        )
        return checks, rep_phase

    if exercise == "Lunge":
        knee_signal = [item.average_knee_angle for item in history]
        rep_phase = infer_rep_phase(knee_signal, 115, 160)
        left_angle = current_metrics.left_knee_angle
        right_angle = current_metrics.right_knee_angle
        front_side = "left"
        if left_angle is not None and right_angle is not None and right_angle < left_angle:
            front_side = "right"
        other_side = "right" if front_side == "left" else "left"
        front_angle = left_angle if front_side == "left" else right_angle
        front_knee = maybe_point(landmarks, f"{front_side}_knee")
        front_ankle = maybe_point(landmarks, f"{front_side}_ankle")
        torso_reference = calibration.neutral_torso_angle or 80.0
        torso_threshold = max(66.0, torso_reference - 10.0)
        torso_gap = max(0.0, torso_threshold - (current_metrics.torso_angle_from_horizontal or torso_threshold))
        depth_gap = max(0.0, (front_angle or 0.0) - 145.0)
        knee_offset = abs(front_knee.x - front_ankle.x) * 100 if front_knee and front_ankle else 0.0
        knee_threshold = scaled_offset_threshold(12.0, calibration)
        stability_drift = average([item.shoulder_drift for item in history[-5:]]) or 0.0

        torso_segments = [
            ("torso-left", "left_shoulder", "left_hip", "Torso"),
            ("torso-right", "right_shoulder", "right_hip", "Torso"),
        ]
        front_segments = [
            (f"{front_side}-thigh", f"{front_side}_hip", f"{front_side}_knee", "Front leg"),
            (f"{front_side}-shin", f"{front_side}_knee", f"{front_side}_ankle", "Front leg"),
        ]
        back_segments = [
            (f"{other_side}-thigh", f"{other_side}_hip", f"{other_side}_knee", "Back leg"),
            (f"{other_side}-shin", f"{other_side}_knee", f"{other_side}_ankle", "Back leg"),
        ]

        checks.append(
            make_guidance_check(
                "lunge-torso",
                "Torso",
                rep_phase != "setup"
                and current_metrics.torso_angle_from_horizontal is not None
                and current_metrics.torso_angle_from_horizontal < torso_threshold,
                48 + int(torso_gap * 3),
                base_confidence + min(0.12, torso_gap / 30),
                rep_phase,
                "Stay taller through the torso.",
                torso_segments,
            )
        )
        checks.append(
            make_guidance_check(
                "lunge-depth",
                "Front-leg depth",
                rep_phase in {"lowering", "driving"} and front_angle is not None and front_angle > 145,
                50 + int(depth_gap * 2),
                base_confidence + min(0.15, depth_gap / 45),
                rep_phase,
                "Sink deeper into the front leg.",
                front_segments,
            )
        )
        checks.append(
            make_guidance_check(
                "lunge-alignment",
                "Front knee track",
                rep_phase in {"lowering", "driving"} and knee_offset > knee_threshold,
                46 + int(max(0.0, knee_offset - knee_threshold) * 2),
                base_confidence + min(0.14, knee_offset / 28),
                rep_phase,
                "Keep the front knee stacked over the foot.",
                front_segments,
            )
        )
        checks.append(
            make_guidance_check(
                "lunge-stability",
                "Split-stance stability",
                rep_phase != "setup" and stability_drift > scaled_offset_threshold(6.5, calibration),
                42 + int(stability_drift * 2),
                base_confidence + min(0.1, stability_drift / 30),
                rep_phase,
                "Stay steadier through the split stance.",
                torso_segments + back_segments,
            )
        )
        return checks, rep_phase

    left_signal = [item.left_elbow_angle for item in history]
    right_signal = [item.right_elbow_angle for item in history]
    _, dominant_side, _ = choose_dominant_signal(left_signal, right_signal)
    dominant_signal = left_signal if dominant_side == "left" else right_signal
    rep_phase = infer_rep_phase(dominant_signal, 70, 140, count_on="low")
    shoulder = maybe_point(landmarks, f"{dominant_side}_shoulder")
    elbow = maybe_point(landmarks, f"{dominant_side}_elbow")
    current_elbow = (
        current_metrics.left_elbow_angle
        if dominant_side == "left"
        else current_metrics.right_elbow_angle
    )
    elbow_drift = abs(elbow.x - shoulder.x) * 100 if shoulder and elbow else 0.0
    drift_threshold = scaled_offset_threshold(10.0, calibration)
    shoulder_cheat_gap = max(0.0, ((shoulder.y - 0.02) - elbow.y) * 100) if shoulder and elbow else 0.0
    curl_gap = max(0.0, (current_elbow or 0.0) - 105.0)
    dominant_recent = recent_valid(dominant_signal, 7)
    tempo_deltas = [
        abs(current - previous)
        for previous, current in zip(dominant_recent, dominant_recent[1:])
    ]
    tempo_jitter = stddev(tempo_deltas)
    arm_segments = [
        (f"{dominant_side}-upper-arm", f"{dominant_side}_shoulder", f"{dominant_side}_elbow", "Upper arm"),
        (f"{dominant_side}-lower-arm", f"{dominant_side}_elbow", f"{dominant_side}_wrist", "Forearm"),
    ]

    checks.append(
        make_guidance_check(
            "curl-drift",
            "Elbow drift",
            rep_phase != "setup" and elbow_drift > drift_threshold,
            46 + int(max(0.0, elbow_drift - drift_threshold) * 2),
            base_confidence + min(0.12, elbow_drift / 26),
            rep_phase,
            "Keep the elbow pinned closer to the side.",
            [arm_segments[0]],
        )
    )
    checks.append(
        make_guidance_check(
            "curl-height",
            "Curl height",
            rep_phase in {"curling", "return"} and current_elbow is not None and current_elbow > 105,
            50 + int(curl_gap * 2),
            base_confidence + min(0.16, curl_gap / 40),
            rep_phase,
            "Bring the hand a little higher at the top.",
            [arm_segments[1]],
        )
    )
    checks.append(
        make_guidance_check(
            "curl-shoulder",
            "Shoulder cheat",
            rep_phase != "setup" and shoulder_cheat_gap > 0,
            44 + int(shoulder_cheat_gap * 3),
            base_confidence + min(0.12, shoulder_cheat_gap / 20),
            rep_phase,
            "Relax the shoulder and avoid hiking it up.",
            [arm_segments[0]],
        )
    )
    checks.append(
        make_guidance_check(
            "curl-tempo",
            "Tempo steadiness",
            rep_phase != "setup" and len(tempo_deltas) >= 3 and tempo_jitter > 8,
            40 + int(tempo_jitter * 2),
            base_confidence + min(0.1, tempo_jitter / 18),
            rep_phase,
            "Smooth out the curl instead of jerking through it.",
            arm_segments,
        )
    )
    return checks, rep_phase


class LiveTracker:
    def __init__(self, selected_exercise: str | None = None) -> None:
        self.history: deque[FrameMetrics] = deque(maxlen=120)
        self.visibility_count = 0
        self.selected_exercise = normalize_selected_exercise(selected_exercise)

    def append(self, metrics: FrameMetrics, visibility_count: int) -> None:
        self.history.append(metrics)
        self.visibility_count = max(self.visibility_count, visibility_count)

    def summarize(self) -> ExerciseSummary:
        return summarize_metrics(
            list(self.history),
            self.visibility_count,
            selected_exercise=self.selected_exercise,
        )

    def reset_recording_window(self) -> None:
        self.history.clear()
        self.visibility_count = 0


class LivePoseAnalyzerSession:
    def __init__(self, selected_exercise: str | None = None) -> None:
        self.loop = asyncio.get_running_loop()
        self.pending: dict[int, asyncio.Future] = {}
        self.selected_exercise = normalize_selected_exercise(selected_exercise)
        self.tracker = LiveTracker(selected_exercise=self.selected_exercise)
        self.calibration = CalibrationProfile()
        self.check_memory: dict[str, LiveCheckMemory] = {}
        self.current_mode = "calibration"
        self.squat_metric_history: dict[str, deque] = {
            "crotch_angle": deque(maxlen=8),
            "shoulder_width": deque(maxlen=8),
            "feet_width": deque(maxlen=8),
            "feet_width_ratio": deque(maxlen=8),
            "torso_vs_vertical_angle": deque(maxlen=8),
            "midfoot_bar_offset": deque(maxlen=8),
            "elbow_body_parallel_angle": deque(maxlen=8),
        }
        self.squat_point_history: dict[str, deque] = {
            "left_midfoot": deque(maxlen=6),
            "right_midfoot": deque(maxlen=6),
            "shoulder_mid": deque(maxlen=6),
            "hip_mid": deque(maxlen=6),
            "visible_wrist": deque(maxlen=6),
            "visible_elbow": deque(maxlen=6),
        }
        self.bar_center: tuple[float, float] | None = None
        self.bar_center_misses = 0
        self.landmarker = self._create_landmarker()

    def _create_landmarker(self) -> vision.PoseLandmarker:
        model_path = ensure_model_file()
        base_options = python.BaseOptions(model_asset_path=str(model_path))
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.LIVE_STREAM,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            result_callback=self._on_result,
        )
        return vision.PoseLandmarker.create_from_options(options)

    def _on_result(
        self,
        result: vision.PoseLandmarkerResult,
        _output_image: mp.Image,
        timestamp_ms: int,
    ) -> None:
        future = self.pending.pop(timestamp_ms, None)
        if future and not future.done():
            self.loop.call_soon_threadsafe(future.set_result, result)

    def _reset_squat_geometry(self) -> None:
        for history in self.squat_metric_history.values():
            history.clear()
        for history in self.squat_point_history.values():
            history.clear()
        self.bar_center = None
        self.bar_center_misses = 0

    def _smooth_numeric_value(self, key: str, value: float | None) -> float | None:
        history = self.squat_metric_history[key]
        if value is not None and math.isfinite(value):
            history.append(value)
        return average(list(history))

    def _smooth_point_value(
        self,
        key: str,
        value: tuple[float, float] | None,
    ) -> tuple[float, float] | None:
        history = self.squat_point_history[key]
        if value is not None:
            history.append(value)
        return average_point_2d(list(history))

    def _smooth_bar_center(self, value: tuple[float, float] | None) -> tuple[float, float] | None:
        if value is None:
            self.bar_center_misses += 1
            if self.bar_center_misses > 4:
                self.bar_center = None
            return self.bar_center

        if self.bar_center is None:
            self.bar_center = value
        else:
            self.bar_center = (
                self.bar_center[0] * 0.58 + value[0] * 0.42,
                self.bar_center[1] * 0.58 + value[1] * 0.42,
            )
        self.bar_center_misses = 0
        return self.bar_center

    def _build_squat_geometry(
        self,
        image_rgb: np.ndarray,
        landmarks: dict[str, PosePoint],
        world_landmarks: dict[str, PosePoint],
        visibility_count: int,
    ) -> tuple[SquatMetricSnapshot, list[dict[str, float | str]]]:
        if visibility_count < 8:
            return SquatMetricSnapshot(), []
        if self.current_mode == "recording" and self.calibration.state == "weak":
            return SquatMetricSnapshot(), []

        gravity_direction = self.calibration.gravity_direction
        if gravity_direction is None:
            return SquatMetricSnapshot(), []

        left_shoulder_2d = maybe_point(landmarks, "left_shoulder")
        right_shoulder_2d = maybe_point(landmarks, "right_shoulder")
        left_hip_2d = maybe_point(landmarks, "left_hip")
        right_hip_2d = maybe_point(landmarks, "right_hip")
        left_heel_2d = maybe_point(landmarks, "left_heel")
        right_heel_2d = maybe_point(landmarks, "right_heel")
        left_foot_index_2d = maybe_point(landmarks, "left_foot_index")
        right_foot_index_2d = maybe_point(landmarks, "right_foot_index")

        left_midfoot_2d = (
            ((left_heel_2d.x + left_foot_index_2d.x) / 2, (left_heel_2d.y + left_foot_index_2d.y) / 2)
            if left_heel_2d and left_foot_index_2d
            else None
        )
        right_midfoot_2d = (
            ((right_heel_2d.x + right_foot_index_2d.x) / 2, (right_heel_2d.y + right_foot_index_2d.y) / 2)
            if right_heel_2d and right_foot_index_2d
            else None
        )
        shoulder_mid_2d = (
            ((left_shoulder_2d.x + right_shoulder_2d.x) / 2, (left_shoulder_2d.y + right_shoulder_2d.y) / 2)
            if left_shoulder_2d and right_shoulder_2d
            else None
        )
        hip_mid_2d = (
            ((left_hip_2d.x + right_hip_2d.x) / 2, (left_hip_2d.y + right_hip_2d.y) / 2)
            if left_hip_2d and right_hip_2d
            else None
        )

        visible_side = pick_visible_side(landmarks)
        visible_wrist = maybe_point(landmarks, f"{visible_side}_wrist")
        visible_elbow = maybe_point(landmarks, f"{visible_side}_elbow")
        smoothed_left_midfoot = self._smooth_point_value("left_midfoot", left_midfoot_2d)
        smoothed_right_midfoot = self._smooth_point_value("right_midfoot", right_midfoot_2d)
        smoothed_shoulder_mid = self._smooth_point_value("shoulder_mid", shoulder_mid_2d)
        smoothed_hip_mid = self._smooth_point_value("hip_mid", hip_mid_2d)
        smoothed_visible_wrist = self._smooth_point_value(
            "visible_wrist",
            (visible_wrist.x, visible_wrist.y) if visible_wrist else None,
        )
        smoothed_visible_elbow = self._smooth_point_value(
            "visible_elbow",
            (visible_elbow.x, visible_elbow.y) if visible_elbow else None,
        )

        left_shoulder_world = maybe_point(world_landmarks, "left_shoulder")
        right_shoulder_world = maybe_point(world_landmarks, "right_shoulder")
        left_heel_world = maybe_point(world_landmarks, "left_heel")
        right_heel_world = maybe_point(world_landmarks, "right_heel")
        left_foot_index_world = maybe_point(world_landmarks, "left_foot_index")
        right_foot_index_world = maybe_point(world_landmarks, "right_foot_index")

        shoulder_width = (
            distance_3d(left_shoulder_world, right_shoulder_world)
            if left_shoulder_world and right_shoulder_world
            else None
        )
        left_midfoot_world = (
            midpoint(left_heel_world, left_foot_index_world)
            if left_heel_world and left_foot_index_world
            else None
        )
        right_midfoot_world = (
            midpoint(right_heel_world, right_foot_index_world)
            if right_heel_world and right_foot_index_world
            else None
        )
        feet_width = (
            distance_xz(left_midfoot_world, right_midfoot_world)
            if left_midfoot_world and right_midfoot_world
            else None
        )
        baseline_shoulder_width = self.calibration.standing_shoulder_width or shoulder_width
        feet_width_ratio = (
            feet_width / baseline_shoulder_width
            if feet_width is not None and baseline_shoulder_width not in (None, 0)
            else None
        )
        crotch_angle = compute_squat_crotch_angle(world_landmarks)

        torso_vs_vertical_angle = None
        torso_direction: tuple[float, float] | None = None
        if smoothed_shoulder_mid and smoothed_hip_mid:
            torso_direction = normalize_vector_2d(
                smoothed_hip_mid[0] - smoothed_shoulder_mid[0],
                smoothed_hip_mid[1] - smoothed_shoulder_mid[1],
            )
            if torso_direction is not None:
                torso_vs_vertical_angle = math.degrees(
                    math.acos(
                        clamp(
                            torso_direction[0] * gravity_direction[0] + torso_direction[1] * gravity_direction[1],
                            -1.0,
                            1.0,
                        )
                    )
                )

        elbow_body_parallel_angle = None
        if smoothed_visible_wrist and smoothed_visible_elbow and torso_direction is not None:
            elbow_body_parallel_angle = angle_between_vectors_2d(
                (
                    smoothed_visible_elbow[0] - smoothed_visible_wrist[0],
                    smoothed_visible_elbow[1] - smoothed_visible_wrist[1],
                ),
                torso_direction,
                acute=True,
            )

        snapshot = SquatMetricSnapshot(
            crotch_angle=self._smooth_numeric_value("crotch_angle", crotch_angle),
            shoulder_width=self._smooth_numeric_value("shoulder_width", shoulder_width),
            feet_width=self._smooth_numeric_value("feet_width", feet_width),
            feet_width_ratio=self._smooth_numeric_value("feet_width_ratio", feet_width_ratio),
            torso_vs_vertical_angle=self._smooth_numeric_value(
                "torso_vs_vertical_angle",
                torso_vs_vertical_angle,
            ),
            midfoot_bar_offset=None,
            elbow_body_parallel_angle=self._smooth_numeric_value(
                "elbow_body_parallel_angle",
                elbow_body_parallel_angle,
            ),
        )

        bar_detection = detect_barbell_end_center(image_rgb, landmarks, visible_side)
        smoothed_bar_center = self._smooth_bar_center(bar_detection)
        snapshot.bar_center_detected = smoothed_bar_center is not None
        visible_midfoot = smoothed_left_midfoot if visible_side == "left" else smoothed_right_midfoot
        if visible_midfoot is not None and smoothed_bar_center is not None:
            ground_normal = normalize_vector_2d(-gravity_direction[1], gravity_direction[0])
            if ground_normal is not None:
                midfoot_bar_offset = abs(
                    (smoothed_bar_center[0] - visible_midfoot[0]) * ground_normal[0]
                    + (smoothed_bar_center[1] - visible_midfoot[1]) * ground_normal[1]
                )
                snapshot.midfoot_bar_offset = self._smooth_numeric_value(
                    "midfoot_bar_offset",
                    midfoot_bar_offset,
                )

        overlay_lines: list[OverlayLine] = []

        if smoothed_left_midfoot:
            left_line = build_centered_line(smoothed_left_midfoot, gravity_direction, 0.18)
            if left_line is not None:
                overlay_lines.append(
                    OverlayLine(
                        id="left-midfoot-line",
                        label="Left midfoot",
                        kind="reference",
                        x1=left_line[0],
                        y1=left_line[1],
                        x2=left_line[2],
                        y2=left_line[3],
                    )
                )

        if smoothed_right_midfoot:
            right_line = build_centered_line(smoothed_right_midfoot, gravity_direction, 0.18)
            if right_line is not None:
                overlay_lines.append(
                    OverlayLine(
                        id="right-midfoot-line",
                        label="Right midfoot",
                        kind="reference",
                        x1=right_line[0],
                        y1=right_line[1],
                        x2=right_line[2],
                        y2=right_line[3],
                    )
                )

        if smoothed_bar_center:
            bar_line = build_centered_line(smoothed_bar_center, gravity_direction, 0.26)
            if bar_line is not None:
                overlay_lines.append(
                    OverlayLine(
                        id="bar-center-line",
                        label="Bar center",
                        kind="bar",
                        x1=bar_line[0],
                        y1=bar_line[1],
                        x2=bar_line[2],
                        y2=bar_line[3],
                    )
                )

        if smoothed_visible_wrist and smoothed_visible_elbow:
            elbow_line = build_directed_line(
                smoothed_visible_wrist,
                (
                    smoothed_visible_elbow[0] - smoothed_visible_wrist[0],
                    smoothed_visible_elbow[1] - smoothed_visible_wrist[1],
                ),
                0.2,
            )
            if elbow_line is not None:
                overlay_lines.append(
                    OverlayLine(
                        id="elbow-line",
                        label="Elbow line",
                        kind="limb",
                        x1=elbow_line[0],
                        y1=elbow_line[1],
                        x2=elbow_line[2],
                        y2=elbow_line[3],
                    )
                )

        if smoothed_shoulder_mid and smoothed_hip_mid and torso_direction is not None:
            torso_center = (
                (smoothed_shoulder_mid[0] + smoothed_hip_mid[0]) / 2,
                (smoothed_shoulder_mid[1] + smoothed_hip_mid[1]) / 2,
            )
            torso_line = build_centered_line(
                torso_center,
                torso_direction,
                0.2,
            )
            if torso_line is not None:
                overlay_lines.append(
                    OverlayLine(
                        id="torso-line",
                        label="Torso line",
                        kind="torso",
                        x1=torso_line[0],
                        y1=torso_line[1],
                        x2=torso_line[2],
                        y2=torso_line[3],
                    )
                )

        return snapshot, [overlay_line_payload(line) for line in overlay_lines]

    def _serialize_checks(self) -> list[dict[str, float | int | str]]:
        ordered = sorted(
            self.check_memory.items(),
            key=lambda item: (
                0 if item[1].status == "warn" else 1,
                -item[1].severity,
                -item[1].confidence,
                item[0],
            ),
        )
        return [
            {
                "id": check_id,
                "label": state.label,
                "status": state.status,
                "severity": state.severity,
                "confidence": round(state.confidence, 2),
                "phase": state.phase,
                "message": state.message,
            }
            for check_id, state in ordered
            if state.label
        ]

    def _stabilize_checks(self, raw_checks: list[LiveGuidanceCheck]) -> None:
        seen_ids = {check.id for check in raw_checks}

        for check in raw_checks:
            memory = self.check_memory.setdefault(check.id, LiveCheckMemory())
            if check.status == "warn":
                memory.score = clamp(memory.score + (0.16 + check.confidence * 0.28), 0.0, 1.0)
            else:
                memory.score = clamp(memory.score - 0.18, 0.0, 1.0)

            if memory.score >= 0.58:
                memory.status = "warn"
            elif memory.score <= 0.28:
                memory.status = "ok"

            memory.severity = check.severity
            memory.confidence = check.confidence
            memory.phase = check.phase
            memory.message = check.message
            memory.label = check.label
            memory.segments = check.segments

        for check_id, memory in self.check_memory.items():
            if check_id in seen_ids:
                continue
            memory.score = clamp(memory.score - 0.24, 0.0, 1.0)
            if memory.score <= 0.28:
                memory.status = "ok"

    def _build_overlay_segments(self) -> list[dict[str, str]]:
        segments: dict[str, dict[str, str]] = {}

        for memory in self.check_memory.values():
            if not memory.segments:
                continue
            for segment_id, from_landmark, to_landmark, label in memory.segments:
                existing = segments.get(segment_id)
                next_status = "warn" if memory.status == "warn" else "ok"
                if existing is None or next_status == "warn":
                    segments[segment_id] = {
                        "id": segment_id,
                        "from_landmark": from_landmark,
                        "to_landmark": to_landmark,
                        "label": label,
                        "status": next_status,
                    }

        return list(segments.values())

    def _select_primary_cues(
        self,
        exercise: str | None,
        visibility_count: int,
    ) -> list[str]:
        if self.calibration.state == "weak" or visibility_count < 8:
            return ["Move fully into frame so coaching stays accurate."]

        active_warnings = [
            memory
            for memory in self.check_memory.values()
            if memory.status == "warn" and memory.confidence >= 0.58
        ]

        if not active_warnings:
            if exercise:
                return [positive_guidance_message(exercise)]
            return ["Looks good. Keep going."]

        ranked = sorted(
            active_warnings,
            key=lambda memory: (
                memory.severity * (0.7 + memory.confidence * 0.3) * (0.6 + memory.score * 0.4)
            ),
            reverse=True,
        )
        cues: list[str] = []
        for memory in ranked:
            if memory.message not in cues:
                cues.append(memory.message)
            if len(cues) == 2:
                break
        return cues

    def _compute_guidance_confidence(self) -> float:
        warn_confidences = [
            memory.confidence
            for memory in self.check_memory.values()
            if memory.status == "warn"
        ]
        if warn_confidences:
            return round(max(self.calibration.guidance_confidence, average(warn_confidences) or 0.0), 2)
        return round(self.calibration.guidance_confidence, 2)

    async def analyze(
        self,
        image_rgb: np.ndarray,
        timestamp_ms: int,
        analysis_mode: str = "recording",
    ) -> ExerciseSummary:
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        future = self.loop.create_future()
        self.pending[timestamp_ms] = future
        self.landmarker.detect_async(mp_image, timestamp_ms)
        result: vision.PoseLandmarkerResult = await asyncio.wait_for(future, timeout=2.0)
        return self._summarize_result(result, image_rgb, timestamp_ms, analysis_mode)

    def _summarize_result(
        self,
        result: vision.PoseLandmarkerResult,
        image_rgb: np.ndarray,
        timestamp_ms: int,
        analysis_mode: str,
    ) -> ExerciseSummary:
        if analysis_mode != self.current_mode and analysis_mode == "recording":
            self.calibration.freeze()
            self.tracker.reset_recording_window()
            self.check_memory = {}
            self._reset_squat_geometry()
        self.current_mode = analysis_mode

        if not result.pose_landmarks:
            self.calibration.observed_frames += 1
            self.calibration.visibility_samples.append(0)
            primary_cues = (
                countdown_guidance_message(self.calibration)
                if analysis_mode == "calibration"
                else ["Move fully into frame so coaching stays accurate."]
            )
            return ExerciseSummary(
                exercise=self.selected_exercise or "Unknown",
                confidence=0.2,
                rep_count=0,
                overall_score=35,
                metrics={"range_of_motion": 30, "stability": 35, "tempo": 35, "setup": 30},
                feedback=["No full-body pose detected yet."],
                cues=primary_cues,
                form_status="needs_work",
                rep_events=[],
                selected_exercise=self.selected_exercise,
                feedback_items=primary_cues,
                primary_cues=primary_cues,
                guidance_confidence=self.calibration.guidance_confidence,
                calibration_state=self.calibration.state,
                rep_phase="setup",
            )

        landmarks = {
            name: PosePoint(
                x=landmark.x,
                y=landmark.y,
                z=landmark.z,
                visibility=getattr(landmark, "visibility", 0.0),
            )
            for name, landmark in zip(POSE_NAMES, result.pose_landmarks[0])
        }
        visibility_count = sum(
            1
            for landmark in result.pose_landmarks[0]
            if getattr(landmark, "visibility", 0.0) > 0.35
        )
        world_landmarks = {
            name: PosePoint(
                x=landmark.x,
                y=landmark.y,
                z=landmark.z,
                visibility=getattr(landmark, "visibility", getattr(result.pose_landmarks[0][index], "visibility", 0.0)),
            )
            for index, (name, landmark) in enumerate(
                zip(POSE_NAMES, result.pose_world_landmarks[0] if result.pose_world_landmarks else [])
            )
        }
        metrics = metrics_from_landmarks(landmarks, timestamp_ms)
        self.calibration.observe(landmarks, world_landmarks, metrics, visibility_count)
        squat_snapshot = SquatMetricSnapshot()
        squat_overlay_lines: list[dict[str, float | str]] = []
        if self.selected_exercise == "Squat":
            squat_snapshot, squat_overlay_lines = self._build_squat_geometry(
                image_rgb,
                landmarks,
                world_landmarks,
                visibility_count,
            )

        if analysis_mode == "calibration":
            primary_cues = countdown_guidance_message(self.calibration)
            return ExerciseSummary(
                exercise=self.selected_exercise or "Unknown",
                confidence=0.3,
                rep_count=0,
                overall_score=40,
                metrics={"range_of_motion": 40, "stability": 40, "tempo": 40, "setup": 40},
                feedback=[],
                cues=primary_cues,
                form_status="good" if self.calibration.state == "ready" else "needs_work",
                rep_events=[],
                selected_exercise=self.selected_exercise,
                pose_landmarks=serialize_pose_landmarks(landmarks),
                overlay_lines=squat_overlay_lines,
                squat_metrics=squat_snapshot.as_payload(),
                feedback_items=primary_cues,
                primary_cues=primary_cues,
                guidance_confidence=self.calibration.guidance_confidence,
                calibration_state=self.calibration.state,
                rep_phase="setup",
            )

        self.tracker.append(metrics, visibility_count)
        summary = self.tracker.summarize()
        guided_exercise = self.selected_exercise or normalize_selected_exercise(summary.exercise)
        rep_phase = "setup"
        if guided_exercise and self.calibration.state == "ready" and visibility_count >= 8:
            raw_checks, rep_phase = build_live_checks(
                guided_exercise,
                landmarks,
                list(self.tracker.history),
                visibility_count,
                self.calibration,
            )
            self._stabilize_checks(raw_checks)
        else:
            self.check_memory = {}

        primary_cues = self._select_primary_cues(guided_exercise, visibility_count)
        overlay_segments = self._build_overlay_segments()
        checks = self._serialize_checks()

        summary.selected_exercise = guided_exercise
        summary.pose_landmarks = serialize_pose_landmarks(landmarks)
        summary.overlay_segments = overlay_segments
        summary.overlay_lines = squat_overlay_lines if guided_exercise == "Squat" else []
        summary.squat_metrics = squat_snapshot.as_payload() if guided_exercise == "Squat" else {}
        summary.feedback_items = primary_cues
        summary.checks = checks
        summary.primary_cues = primary_cues
        summary.guidance_confidence = self._compute_guidance_confidence()
        summary.calibration_state = self.calibration.state
        summary.rep_phase = rep_phase
        summary.cues = primary_cues
        summary.form_status = (
            "needs_work"
            if any(check["status"] == "warn" for check in checks)
            else "good"
        )
        if guided_exercise:
            summary.exercise = guided_exercise
        return summary

    def close(self) -> None:
        self.landmarker.close()


def analyze_video_file(
    video_path: Path, selected_exercise: str | None = None
) -> ExerciseSummary:
    model_path = ensure_model_file()
    base_options = python.BaseOptions(model_asset_path=str(model_path))
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    frame_metrics: list[FrameMetrics] = []
    max_visibility_count = 0

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        capture = cv2.VideoCapture(str(video_path))
        frame_index = 0
        fps = capture.get(cv2.CAP_PROP_FPS) or 30
        frame_step = max(int(round(fps / settings.analysis_frame_sample_fps)), 1)

        try:
            while capture.isOpened():
                success, frame = capture.read()
                if not success:
                    break

                if frame_index % frame_step != 0:
                    frame_index += 1
                    continue

                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                timestamp_ms = int((frame_index / fps) * 1000)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                result = landmarker.detect_for_video(mp_image, timestamp_ms)

                if result.pose_landmarks:
                    landmarks = {
                        name: PosePoint(
                            x=landmark.x,
                            y=landmark.y,
                            z=landmark.z,
                            visibility=getattr(landmark, "visibility", 0.0),
                        )
                        for name, landmark in zip(POSE_NAMES, result.pose_landmarks[0])
                    }
                    visibility_count = sum(
                        1
                        for landmark in result.pose_landmarks[0]
                        if getattr(landmark, "visibility", 0.0) > 0.35
                    )
                    max_visibility_count = max(max_visibility_count, visibility_count)
                    frame_metrics.append(metrics_from_landmarks(landmarks, timestamp_ms))

                frame_index += 1
        finally:
            capture.release()

    if not frame_metrics:
        return ExerciseSummary(
            exercise="Unknown",
            confidence=0.2,
            rep_count=0,
            overall_score=35,
            metrics={"range_of_motion": 30, "stability": 35, "tempo": 35, "setup": 30},
            feedback=["No usable pose landmarks detected from this video."],
            cues=["Use a full-body side angle"],
            form_status="needs_work",
            rep_events=[],
        )

    return summarize_metrics(
        frame_metrics,
        max_visibility_count,
        selected_exercise=selected_exercise,
    )


def generate_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"

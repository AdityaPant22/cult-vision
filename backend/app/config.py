from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")
DATA_DIR = ROOT_DIR / "backend" / "data"
MODEL_DIR = ROOT_DIR / "backend" / "models"


@dataclass(frozen=True)
class Settings:
    app_name: str = "Cult Vision Analysis API"
    api_prefix: str = "/api"
    database_url: str = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{(DATA_DIR / 'cult_vision.db').as_posix()}",
    )
    storage_backend: str = os.getenv("STORAGE_BACKEND", "local")
    storage_dir: Path = Path(os.getenv("STORAGE_DIR", str(DATA_DIR / "storage")))
    storage_public_base_url: str = os.getenv("STORAGE_PUBLIC_BASE_URL", "")
    s3_bucket: str = os.getenv("S3_BUCKET", "")
    s3_endpoint_url: str = os.getenv("S3_ENDPOINT_URL", "")
    s3_region: str = os.getenv("S3_REGION", "auto")
    aws_access_key_id: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    aws_secret_access_key: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    mediapipe_model_path: Path = Path(
        os.getenv(
            "MEDIAPIPE_MODEL_PATH",
            str(MODEL_DIR / "pose_landmarker_lite.task"),
        )
    )
    mediapipe_model_url: str = os.getenv(
        "MEDIAPIPE_MODEL_URL",
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    )
    analysis_frame_sample_fps: int = int(os.getenv("ANALYSIS_FRAME_SAMPLE_FPS", "5"))
    allowed_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )

    # Cloudinary (unsigned upload)
    cloudinary_cloud_name: str = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    cloudinary_upload_preset: str = os.getenv("CLOUDINARY_UPLOAD_PRESET", "vedios")

    # Supabase
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_key: str = os.getenv("SUPABASE_KEY", "")

    # OpenRouter AI
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")


settings = Settings()

DATA_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)
settings.storage_dir.mkdir(parents=True, exist_ok=True)

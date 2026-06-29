from pathlib import Path

print("STEP 1 - Imports starting")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoformerForPrediction

from pymongo import MongoClient
from dotenv import load_dotenv

import json
import os
import torch
import numpy as np

print("STEP 2 - Imports completed")

app = FastAPI()

print("STEP 3 - FastAPI created")

# --------------------------------------------------
# MongoDB
# --------------------------------------------------
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

print("MONGO_URI:")
print(MONGO_URI)

client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=5000
)

db = client["machine_monitor"]

active_models = db["activemodels"]

print("STEP 4 - MongoDB connected")

# --------------------------------------------------
# Base Directory
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

MODEL_KEYS = [
    "temperature",
    "current",
    "vibration",
]

print("STEP 5 - Config loaded")

# --------------------------------------------------
# Active Model Lookup
# --------------------------------------------------
def get_active_model_folder(model_name: str):

    active_models_file = (
        BASE_DIR
        / "models"
        / "active_models.json"
    )

    try:

        with open(
            active_models_file,
            "r"
        ) as f:

            active_models = json.load(f)

        active_version = active_models.get(
            model_name
        )

        if active_version:

            model_path = (
                BASE_DIR
                / "models"
                / active_version
            )

            print(
                f"Loading ACTIVE model for "
                f"{model_name}: "
                f"{active_version}"
            )

            return model_path

    except Exception as e:

        print(
            f"Could not load active_models.json: "
            f"{e}"
        )

    print(
        f"Using default model for "
        f"{model_name}"
    )

    return (
        BASE_DIR
        / "models"
        / model_name
    )
# --------------------------------------------------
# Load Model Bundle
# --------------------------------------------------

def load_model_bundle(model_key: str):

    print(f"\nLoading bundle for {model_key}")

    model_path = get_active_model_folder(model_key)

    print(f"Checking path: {model_path}")

    if not model_path.exists():
        raise FileNotFoundError(
            f"Model folder not found: {model_path}"
        )

    print(f"Loading Autoformer: {model_key}")

    model = AutoformerForPrediction.from_pretrained(
        str(model_path),
        local_files_only=True
    )

    print(f"Loaded model: {model_key}")

    model.eval()

    meta_path = model_path / "meta.json"

    print(f"Loading meta: {meta_path}")

    with open(meta_path, "r") as f:
        meta = json.load(f)

    print(f"Meta loaded: {model_key}")

    return {
        "model": model,
        "meta": meta,
        "mean": float(meta["mean"]),
        "std": float(meta["std"]),
        "past_len": int(meta["past_len"]),
        "future_len": int(meta["future_len"]),
        "path": str(model_path),
    }


# --------------------------------------------------
# Load Models
# --------------------------------------------------

print("STEP 6 - Starting model loading")

MODEL_BUNDLES = {}
MODEL_ERRORS = {}

for key in MODEL_KEYS:

    print(f"\n===== {key.upper()} =====")

    try:

        MODEL_BUNDLES[key] = load_model_bundle(key)

        MODEL_ERRORS[key] = None

        print(f"SUCCESS: {key}")

    except Exception as exc:

        MODEL_BUNDLES[key] = None

        MODEL_ERRORS[key] = str(exc)

        print(
            f"FAILED loading model {key}: {exc}"
        )

print("STEP 7 - Model loading finished")


# --------------------------------------------------
# Request Model
# --------------------------------------------------

class PredictRequest(BaseModel):
    values: list[float]


# --------------------------------------------------
# Prediction Logic
# --------------------------------------------------

def predict_with_bundle(bundle, values):

    if bundle is None:
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded"
        )

    mean = bundle["mean"]
    std = bundle["std"]

    past_len = bundle["past_len"]
    future_len = bundle["future_len"]

    model = bundle["model"]

    if len(values) != past_len:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {past_len} values, got {len(values)}",
        )

    values_np = np.array(
        values,
        dtype=np.float32
    )

    normalized = (
        values_np - mean
    ) / std

    past_values = torch.tensor(
        normalized,
        dtype=torch.float32
    ).unsqueeze(0)

    past_observed_mask = torch.ones(
        (1, past_len),
        dtype=torch.float32
    )

    past_time_features = torch.zeros(
        (1, past_len, 2),
        dtype=torch.float32
    )

    future_time_features = torch.zeros(
        (1, future_len, 2),
        dtype=torch.float32
    )

    static_categorical_features = torch.zeros(
        (1, 1),
        dtype=torch.long
    )

    with torch.no_grad():

        outputs = model.generate(
            past_values=past_values,
            past_time_features=past_time_features,
            past_observed_mask=past_observed_mask,
            future_time_features=future_time_features,
            static_categorical_features=static_categorical_features,
        )

    seq = outputs.sequences.detach().cpu().numpy()

    if seq.ndim == 3:
        seq = seq[0]

    if seq.ndim == 2:
        forecast_norm = seq.mean(axis=0)

    elif seq.ndim == 1:
        forecast_norm = seq

    else:

        forecast_norm = np.squeeze(seq)

        if forecast_norm.ndim > 1:
            forecast_norm = (
                forecast_norm.reshape(-1)[:future_len]
            )

    forecast_norm = (
        np.asarray(forecast_norm)
        .reshape(-1)[:future_len]
    )

    forecast = (
        forecast_norm * std
    ) + mean

    forecast = [
        round(float(x), 4)
        for x in forecast
    ]

    return {
        "past_len": past_len,
        "future_len": future_len,
        "forecast": forecast,
    }


def predict_model(model_key: str, req: PredictRequest):

    bundle = MODEL_BUNDLES.get(model_key)

    return predict_with_bundle(
        bundle,
        req.values
    )


# --------------------------------------------------
# Health
# --------------------------------------------------

@app.get("/health")
def health():

    return {
        "status": "ok",
        "model_loaded": all(
            bundle is not None
            for bundle in MODEL_BUNDLES.values()
        ),
        "models": {
            key: {
                "loaded":
                MODEL_BUNDLES.get(key) is not None,

                "error":
                MODEL_ERRORS.get(key),

                "path":
                MODEL_BUNDLES[key]["path"]
                if MODEL_BUNDLES.get(key)
                else None,

                "meta":
                MODEL_BUNDLES[key]["meta"]
                if MODEL_BUNDLES.get(key)
                else None,
            }
            for key in MODEL_KEYS
        },
    }


import sys
import subprocess
import time
from datetime import datetime

# --------------------------------------------------
# Routes
# --------------------------------------------------

@app.post("/retrain")
def retrain():
    started_at = datetime.utcnow().isoformat()
    start_time = time.time()
    
    script_path = str(BASE_DIR / "retrain" / "retrain_all.py")
    print(f"[FASTAPI] Starting retraining... script: {script_path}")
    
    try:
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True
        )
        
        duration = time.time() - start_time
        finished_at = datetime.utcnow().isoformat()
        
        success = (result.returncode == 0)
        
        response_data = {
            "success": success,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "durationSeconds": round(duration, 2)
        }
        
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
            
        if not success:
            raise HTTPException(
                status_code=500,
                detail=response_data
            )
            
        print("[FASTAPI] Retraining completed successfully")
        return response_data
        
    except HTTPException as he:
        raise he
    except Exception as e:
        duration = time.time() - start_time
        finished_at = datetime.utcnow().isoformat()
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "stdout": "",
                "stderr": str(e),
                "startedAt": started_at,
                "finishedAt": finished_at,
                "durationSeconds": round(duration, 2)
            }
        )


@app.post("/predict")
def predict(req: PredictRequest):
    return predict_model(
        "temperature",
        req
    )


@app.post("/predict/temperature")
def predict_temperature(req: PredictRequest):
    return predict_model(
        "temperature",
        req
    )


@app.post("/predict/current")
def predict_current(req: PredictRequest):
    return predict_model(
        "current",
        req
    )


@app.post("/predict/vibration")
def predict_vibration(req: PredictRequest):
    return predict_model(
        "vibration",
        req
    )

print("STEP 8 - App fully loaded")
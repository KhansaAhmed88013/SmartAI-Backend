import os
import json

import torch
import numpy as np
import pandas as pd

from pymongo import MongoClient
from dotenv import load_dotenv
from transformers import AutoformerForPrediction

# -----------------------
# Load Models
# -----------------------

OLD_MODEL = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "models",
        "current"
    )
)

NEW_MODEL = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "models",
        "current_retrained"
    )
)

print("Loading old model...")

old_model = AutoformerForPrediction.from_pretrained(
    OLD_MODEL,
    local_files_only=True
)

print("Loading retrained model...")

new_model = AutoformerForPrediction.from_pretrained(
    NEW_MODEL,
    local_files_only=True
)

print("Both models loaded successfully.")

# -----------------------
# MongoDB
# -----------------------

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

client = MongoClient(MONGO_URI)

db = client["machine_monitor"]

records = list(
    db["sensordatas"].find(
        {},
        {
            "_id": 0,
            "timestamp": 1,
            "current": 1
        }
    ).sort("timestamp", 1)
)

df = pd.DataFrame(records)

df = df.rename(
    columns={
        "timestamp": "ds",
        "current": "y"
    }
)

df["ds"] = pd.to_datetime(df["ds"])

df = df.dropna()

# Same cleaning used in retraining

df = df[
    (df["y"] >= 0) &
    (df["y"] <= 50)
]

print("Rows:", len(df))

# -----------------------
# Data
# -----------------------

data = df["y"].values.astype(np.float32)

split_index = int(len(data) * 0.8)

train_data = data[:split_index]
validation_data = data[split_index:]

print("Train Samples:", len(train_data))
print("Validation Samples:", len(validation_data))

# -----------------------
# Lengths
# -----------------------

PAST_LEN = (
    old_model.config.context_length
    + max(old_model.config.lags_sequence)
)

FUTURE_LEN = old_model.config.prediction_length

print("PAST_LEN:", PAST_LEN)
print("FUTURE_LEN:", FUTURE_LEN)

past_values = data[
    -(PAST_LEN + FUTURE_LEN):-FUTURE_LEN
]

actual_future = data[-FUTURE_LEN:]

print("Past Values:", len(past_values))
print("Actual Future:", len(actual_future))

# -----------------------
# Load Meta
# -----------------------

meta_path = os.path.join(
    OLD_MODEL,
    "meta.json"
)

with open(meta_path, "r") as f:
    meta = json.load(f)

mean = meta["mean"]
std = meta["std"]

print("Mean:", mean)
print("Std:", std)

# -----------------------
# Normalize
# -----------------------

past_values_norm = (
    past_values - mean
) / std

# -----------------------
# Time Features
# -----------------------

def build_time_features(total_len):
    t = np.arange(
        total_len,
        dtype=np.float32
    )

    f1 = t / max(total_len - 1, 1)

    f2 = np.sin(
        2 * np.pi * t / max(total_len, 1)
    )

    return np.stack(
        [f1, f2],
        axis=-1
    )

# -----------------------
# Tensors
# -----------------------

past_values_tensor = torch.tensor(
    past_values_norm,
    dtype=torch.float32
).unsqueeze(0)

past_observed_mask = torch.ones(
    (1, PAST_LEN),
    dtype=torch.float32
)

total_tf = build_time_features(
    PAST_LEN + FUTURE_LEN
)

past_time_features = torch.tensor(
    total_tf[:PAST_LEN],
    dtype=torch.float32
).unsqueeze(0)

future_time_features = torch.tensor(
    total_tf[PAST_LEN:],
    dtype=torch.float32
).unsqueeze(0)

static_categorical_features = torch.tensor(
    [[0]],
    dtype=torch.long
)

# -----------------------
# Predict OLD Model
# -----------------------

print("\nGenerating OLD model forecast...")

with torch.no_grad():
    old_output = old_model.generate(
        past_values=past_values_tensor,
        past_time_features=past_time_features,
        past_observed_mask=past_observed_mask,
        future_time_features=future_time_features,
        static_categorical_features=static_categorical_features,
    )

old_pred = old_output.sequences.cpu().numpy()

print("Raw Prediction Shape:")
print(old_pred.shape)

old_pred_mean = old_pred.mean(
    axis=1
).flatten()

old_pred_real = (
    old_pred_mean * std
) + mean

print("\nPredicted Points:")
print(len(old_pred_real))

print("\nFirst 5 Predictions:")
print(old_pred_real[:5])

print("\nFirst 5 Actual Values:")
print(actual_future[:5])

print("\nGenerating RETRAINED model forecast...")

with torch.no_grad():
    new_output = new_model.generate(
        past_values=past_values_tensor,
        past_time_features=past_time_features,
        past_observed_mask=past_observed_mask,
        future_time_features=future_time_features,
        static_categorical_features=static_categorical_features,
    )

new_pred = new_output.sequences.cpu().numpy()

new_pred_mean = new_pred.mean(axis=1).flatten()

new_pred_real = (
    new_pred_mean * std
) + mean

print("\nFirst 5 Retrained Predictions:")
print(new_pred_real[:5])

from sklearn.metrics import mean_absolute_error
from sklearn.metrics import mean_squared_error
import datetime

old_mae = mean_absolute_error(
    actual_future,
    old_pred_real
)

new_mae = mean_absolute_error(
    actual_future,
    new_pred_real
)

old_rmse = np.sqrt(
    mean_squared_error(
        actual_future,
        old_pred_real
    )
)

new_rmse = np.sqrt(
    mean_squared_error(
        actual_future,
        new_pred_real
    )
)

old_mape = float(np.mean(np.abs((actual_future - old_pred_real) / np.maximum(np.abs(actual_future), 1e-5))) * 100)
new_mape = float(np.mean(np.abs((actual_future - new_pred_real) / np.maximum(np.abs(actual_future), 1e-5))) * 100)

old_accuracy = max(0.0, 100.0 - old_mape)
new_accuracy = max(0.0, 100.0 - new_mape)

print("\n===== RESULTS =====")

print(f"OLD MAE  : {old_mae:.4f}")
print(f"NEW MAE  : {new_mae:.4f}")

print(f"OLD RMSE : {old_rmse:.4f}")
print(f"NEW RMSE : {new_rmse:.4f}")

print(f"OLD MAPE : {old_mape:.4f}%")
print(f"NEW MAPE : {new_mape:.4f}%")

print(f"OLD ACCURACY : {old_accuracy:.2f}%")
print(f"NEW ACCURACY : {new_accuracy:.2f}%")

if new_rmse < old_rmse:
    winner = "RETRAINED MODEL"
else:
    winner = "OLD MODEL"

print("\nWINNER:")
print(winner)

# Store evaluation results in MongoDB
eval_record = {
    "modelName": "current",
    "oldMAE": float(old_mae),
    "newMAE": float(new_mae),
    "oldRMSE": float(old_rmse),
    "newRMSE": float(new_rmse),
    "oldMAPE": float(old_mape),
    "newMAPE": float(new_mape),
    "oldAccuracy": float(old_accuracy),
    "newAccuracy": float(new_accuracy),
    "accuracy": float(new_accuracy if winner == "RETRAINED MODEL" else old_accuracy),
    "winner": winner,
    "evaluatedAt": datetime.datetime.utcnow()
}
db["modelevaluations"].insert_one(eval_record)
print("Evaluation results saved to MongoDB.")

active_models_file = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "models",
        "active_models.json"
    )
)

with open(active_models_file, "r") as f:
    active_models = json.load(f)

if winner == "RETRAINED MODEL":
    active_models["current"] = "current_retrained"
else:
    active_models["current"] = "current"

with open(active_models_file, "w") as f:
    json.dump(active_models, f, indent=4)

print("Active model updated.")
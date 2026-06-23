import os
import pandas as pd
from dotenv import load_dotenv
from transformers import AutoformerForPrediction
from pymongo import MongoClient

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

# -------------------
# Load model
# -------------------

MODEL_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "models",
        "temperature"
    )
)

model = AutoformerForPrediction.from_pretrained(
    MODEL_DIR,
    local_files_only=True
)

# -------------------
# Load MongoDB data
# -------------------

client = MongoClient(MONGO_URI)

db = client["machine_monitor"]

sensor_collection = db["sensordatas"]

records = list(
    sensor_collection.find(
        {},
        {
            "_id": 0,
            "timestamp": 1,
            "temperature": 1
        }
    ).sort("timestamp", 1)
)

df = pd.DataFrame(records)

df = df.rename(
    columns={
        "timestamp": "ds",
        "temperature": "y"
    }
)

df["ds"] = pd.to_datetime(df["ds"])

df = df.dropna()

# Remove obvious bad temperature readings
df = df[(df["y"] >= 0) & (df["y"] <= 50)]

print("Rows after cleaning:", len(df))

# -------------------
# Calculate lengths
# -------------------

PAST_LEN = model.config.context_length + max(model.config.lags_sequence)
FUTURE_LEN = model.config.prediction_length

print("Rows:", len(df))
print("PAST_LEN:", PAST_LEN)
print("FUTURE_LEN:", FUTURE_LEN)

possible_sequences = len(df) - PAST_LEN - FUTURE_LEN

print("Possible sequences:", possible_sequences)

import numpy as np

data = df["y"].values.astype(np.float32)

mean = data.mean()
std = data.std()

data = (data - mean) / std

print("Mean:", mean)
print("Std:", std)

def create_sequences(data, past=PAST_LEN, future=FUTURE_LEN):
    X, y = [], []

    for i in range(len(data) - past - future):
        X.append(data[i:i+past])
        y.append(data[i+past:i+past+future])

    return np.array(X), np.array(y)

X, y = create_sequences(data)

print("X shape:", X.shape)
print("y shape:", y.shape)

from datasets import Dataset

def build_time_features(total_len):
    t = np.arange(total_len, dtype=np.float32)

    f1 = t / max(total_len - 1, 1)
    f2 = np.sin(2 * np.pi * t / max(total_len, 1))

    return np.stack([f1, f2], axis=-1).astype(np.float32)

def format_dataset(X, y):
    data_list = []

    for i in range(len(X)):
        past_len = len(X[i])
        future_len = len(y[i])

        total_tf = build_time_features(
            past_len + future_len
        )

        past_tf = total_tf[:past_len]
        future_tf = total_tf[past_len:]

        data_list.append({
            "past_values": X[i].astype(np.float32),
            "future_values": y[i].astype(np.float32),
            "past_time_features": past_tf,
            "future_time_features": future_tf,
            "past_observed_mask": np.ones(
                (past_len,),
                dtype=np.float32
            ),
            "static_categorical_features": np.array(
                [0],
                dtype=np.int64
            ),
        })

    return Dataset.from_list(data_list)

dataset = format_dataset(X, y)

print("\nDataset Length:", len(dataset))
print("\nFirst Sample Keys:")
print(dataset[0].keys())

print("\nTemperature Stats")
print(df["y"].describe())

print("\nTop 10 Highest Temperatures")
print(
    df.sort_values("y", ascending=False)
      .head(10)[["ds", "y"]]
)

from transformers import TrainingArguments, Trainer

training_args = TrainingArguments(
    output_dir="./retrain_results",
    per_device_train_batch_size=16,
    num_train_epochs=3,
    learning_rate=5e-5,
    remove_unused_columns=False,
    save_strategy="no",
    logging_steps=10
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=dataset,
)

print("\nStarting retraining...")

trainer.train()

print("\nRetraining complete!")

import json
from datetime import datetime

SAVE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "models",
        "temperature_retrained"
    )
)

model.save_pretrained(SAVE_DIR)

meta = {
    "mean": float(mean),
    "std": float(std),
    "past_len": int(PAST_LEN),
    "future_len": int(FUTURE_LEN),
    "trainedAt": datetime.utcnow().isoformat(),
    "samplesUsed": int(len(df))
}

with open(
    os.path.join(SAVE_DIR, "meta.json"),
    "w"
) as f:
    json.dump(meta, f, indent=2)

print("\nModel saved to:")
print(SAVE_DIR)

history_collection = db["modeltraininghistories"]

history_collection.insert_one({
    "modelName": "temperature",
    "modelVersion": "temperature_autoformer_v2",
    "trainedAt": datetime.utcnow(),
    "samplesUsed": int(len(df)),
    "mean": float(mean),
    "std": float(std),
    "trainLoss": float(trainer.state.log_history[-1]["train_loss"]),
    "pastLen": int(PAST_LEN),
    "futureLen": int(FUTURE_LEN),
    "modelPath": SAVE_DIR
})

print("Training history saved to MongoDB")
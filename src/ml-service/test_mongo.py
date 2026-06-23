# mongo_test.py

from pymongo import MongoClient
from dotenv import load_dotenv
import os

load_dotenv()

uri = os.getenv("MONGO_URI")

client = MongoClient(
    uri,
    serverSelectionTimeoutMS=5000
)

db = client["machine_monitor"]

print("START")

record = db["activemodels"].find_one(
    {"modelName": "temperature"}
)

print("RESULT:")
print(record)

print("DONE")
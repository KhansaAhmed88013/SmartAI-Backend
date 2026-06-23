import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent

steps = [
    ("Retrain Temperature", BASE_DIR / "retrain" / "retrain_temperature.py"),
    ("Evaluate Temperature", BASE_DIR / "evaluate" / "evaluate_temperature.py"),

    ("Retrain Current", BASE_DIR / "retrain" / "retrain_current.py"),
    ("Evaluate Current", BASE_DIR / "evaluate" / "evaluate_current.py"),

    ("Retrain Vibration", BASE_DIR / "retrain" / "retrain_vibration.py"),
    ("Evaluate Vibration", BASE_DIR / "evaluate" / "evaluate_vibration.py"),
]

for name, script in steps:

    print(f"\n{'=' * 60}")
    print(name)
    print(f"{'=' * 60}\n")

    result = subprocess.run(
        [sys.executable, str(script)]
    )

    if result.returncode != 0:
        print(f"\nFAILED: {name}")
        sys.exit(1)

print("\nAll retraining and evaluations completed successfully!")
import mongoose from "mongoose";

const modelEvaluationSchema = new mongoose.Schema(
  {
    modelName: String,

    oldMAE: Number,
    newMAE: Number,

    oldRMSE: Number,
    newRMSE: Number,

    oldMAPE: Number,
    newMAPE: Number,

    oldAccuracy: Number,
    newAccuracy: Number,

    accuracy: Number,

    winner: String,

    evaluatedAt: {
      type: Date,
      default: Date.now,
    },
  }
);

export default mongoose.model(
  "ModelEvaluation",
  modelEvaluationSchema
);
import mongoose from "mongoose";

const ModelTrainingHistorySchema = new mongoose.Schema(
  {
    modelName: {
      type: String,
      required: true,
      enum: ["temperature", "current", "vibration"],
    },

    modelVersion: {
      type: String,
      required: true,
    },

    trainedAt: {
      type: Date,
      default: Date.now,
    },

    samplesUsed: {
      type: Number,
      required: true,
    },

    mean: {
      type: Number,
      required: true,
    },

    std: {
      type: Number,
      required: true,
    },

    trainLoss: {
      type: Number,
      default: null,
    },

    pastLen: {
      type: Number,
      required: true,
    },

    futureLen: {
      type: Number,
      required: true,
    },

    modelPath: {
      type: String,
      default: "",
    },

    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

ModelTrainingHistorySchema.index({
  modelName: 1,
  trainedAt: -1,
});

export default mongoose.model(
  "ModelTrainingHistory",
  ModelTrainingHistorySchema
);
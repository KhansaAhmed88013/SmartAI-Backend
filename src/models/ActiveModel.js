import mongoose from "mongoose";

const activeModelSchema = new mongoose.Schema({
  modelName: String,

  activePath: String,

  version: String,

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model(
  "ActiveModel",
  activeModelSchema
);
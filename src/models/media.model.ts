import mongoose from "mongoose";
import { ITweet, IMedia } from "../utils/interfaces";
const MediaSchema = new mongoose.Schema<IMedia>(
    {
        media_key: { type: String, required: true, unique: true },
        type: { type: String, required: true },
        url: { type: String, required: true },
        preview_image_url: { type: String },
        alt_text: { type: String },
    },
    { timestamps: true }
);

export const Media = mongoose.model("Media", MediaSchema);

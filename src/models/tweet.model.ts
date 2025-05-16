import mongoose from "mongoose";
import { ITweet, IMedia } from "../utils/interfaces";

const MediaSchema = new mongoose.Schema<IMedia>(
  {
    media_key: { type: String, required: true },
    type: { type: String, required: true },
    urls: [{ type: String }], // This should be an array of strings
    preview_image_url: { type: String },
    alt_text: { type: String },
  }
  // { _id: false } // Disable automatic creation of _id field for subdocuments
);

const TweetSchema = new mongoose.Schema<ITweet>(
  {
    author_id: { type: String, required: true },
    tweet_id: { type: String, required: true, unique: true },
    text: { type: String },
    username: { type: String },
    media: [MediaSchema],
    hashtags: String,
    created_at: { type: Date, default: Date.now },
    profile_image_url: { type: String },
    retweet_count: { type: Number, default: 0 },
    like_count: { type: Number, default: 0 },
    reply_count: { type: Number, default: 0 },
    quote_count: { type: Number, default: 0 },
    hasVideo: { type: Boolean, default: false },
  },
  { timestamps: true }
);
export const Tweet = mongoose.model("Tweet", TweetSchema);

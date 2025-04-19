import mongoose from "mongoose";
import { ITweet, IMedia } from "../utils/interfaces";
const TweetSchema = new mongoose.Schema<ITweet>(
  {
    tweet_id: { type: String, required: true, unique: true },
    text: { type: String, required: true },
    author_id: { type: String, required: true },
    username: { type: String },
    created_at: { type: Date, default: Date.now },
    hashtags: String,
    media: [
      {
        media_key: String,
        type: String,
        url: String,
        preview_image_url: String,
      },
    ],
    profile_image_url: { type: String },
    retweet_count: { type: Number, default: 0 },  
    
    // entities: {
    //   urls: [
    //     {
    //       url: String,
    //       expanded_url: String,
    //       display_url: String,
    //     },
    //   ],
    //   hashtags: [
    //     {
    //       tag: String,
    //     },
    //   ],
    //   mentions: [
    //     {
    //       username: String,
    //     },
    //   ],
    // },
  },
  { timestamps: true }
);

export const Tweet = mongoose.model("Tweet", TweetSchema);

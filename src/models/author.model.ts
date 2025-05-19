import mongoose from "mongoose";
import { ITweet, IMedia, IAuthor } from "../utils/interfaces";

const AuthorSchema = new mongoose.Schema<IAuthor>({
  author_id: { type: String, required: true },
  profile_image_url: String,
  username: String,
});

export const Author = mongoose.model("Author", AuthorSchema);

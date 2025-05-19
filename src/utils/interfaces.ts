import { Date, Document } from "mongoose";

export interface IMedia {
  media_key: string;
  type: string;
  url: string;
  preview_image_url?: string;
  alt_text?: string;
}

export interface ITweet {
  author_id: string;
  tweet_id: string;
  text: string;
  username: string;
  media: IMedia[];
  hashtags: string;
  created_at: Date;
  profile_image_url: string;
  retweet_count: number;
  like_count?: number;
  reply_count?: number;
  quote_count?: number;
  hasVideo: boolean;
}

export type MediaItem = {
  media_key: string;
  type: string;
  url: string;
  preview_image_url?: string;
};

export interface STweet {
  author_id: string;
  tweet_id: string;
  text?: string;
  username: string;
  media: IMedia[];
  hashtags: string;
  created_at: string;
  profile_image_url: string;
  retweet_count: number;
  like_count: number;
  reply_count: number;
  quote_count: number;
  hasVideo: boolean;
}

export interface IAuthor {
  author_id: string;
  profile_image_url: string;
  username: string;
}

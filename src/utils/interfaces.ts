import { Date, Document } from "mongoose";

export interface IMedia {
    media_key: string;
    type: string;
    urls?: string[];
    preview_image_url?: string;
    alt_text?: string;
    // media_base_64?: string;
  }

export interface ITweet extends Document{
    author_id:string;
    tweet_id: string;
    text: string;
    username: string;
    media: IMedia[];
    hashtags: string;
    created_at: Date;
    profile_image_url: string;
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
    hasVideo: boolean;
}

export interface STweet{
  id: string;
    author_id:string;
    tweet_id: string;
    text: string;
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
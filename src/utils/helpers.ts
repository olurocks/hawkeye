import axios from "axios";
import { IMedia, MediaItem, ITweet } from "./interfaces";
import { Tweet } from "../models/tweet.model";
import { Server } from "socket.io";
import { Author } from "../models/author.model";
import { X_API_KEY, X_API_SECRET, BEARER_TOKEN } from "../utils/constants";

const token = BEARER_TOKEN;

if (!token) {
  console.error("No Twitter bearer token provided in environment variables");
  process.exit(1);
}

const getLastTweetTime = async (): Promise<string | null> => {
  const lastTweet = await Tweet.findOne().sort({ created_at: -1 });
  return lastTweet ? lastTweet.created_at.toString() : null;
};

export const convertToRFC3339 = (rawDate: string): string | null => {
  try {
    // Decode URI components (e.g., "%2B" → "+")
    const decoded = decodeURIComponent(rawDate.replace(/\+/g, ' '));

    // Create Date object
    const date = new Date(decoded);

    // Check if it's valid
    if (isNaN(date.getTime())) {
      throw new Error("Invalid date format");
    }

    // Convert to RFC3339
    return date.toISOString(); // returns in UTC (e.g., "2025-05-19T08:41:54.000Z")
  } catch (error) {
    console.error("Failed to parse date:", error);
    return null;
  }
};

export const getTweetsFromList = async (listId: string) => {
  try {
    const startTime = await getLastTweetTime();

    const base_url = `https://api.x.com/2/lists/${listId}/tweets`;
    let params: any = {
        "tweet.fields": "author_id,entities,created_at,public_metrics,text",
        expansions: `attachments.media_keys,article.media_entities`,
        max_results: `15`,
        "media.fields": `url,type,preview_image_url`,
    };

    if (startTime) {
        params.start_time = await convertToRFC3339(startTime[0]);
    }

    const tweetResponse = await axios.get(base_url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params,
    });
    if (tweetResponse.status !== 200) {
      console.error("Error fetching tweets from list:", tweetResponse.status);
    }

    return {
      tweets: tweetResponse.data.data,
      includes: tweetResponse.data.includes,
    };
  } catch (error: any) {
    console.log("error fetching tweets from list", error.response.data.errors);
    return {
      tweets: [],
      includes: [],
    };
  }
};

export const processText = async (tweetText: string, tweetId: string) => {
  // Handle retweets first (as in your original code)
  let processedText = tweetText;
  if (processedText.startsWith("RT")) {
    processedText = processedText.slice(3);
    const colonIndex = processedText.indexOf(":");
    if (colonIndex !== -1 && processedText.startsWith("@")) {
      processedText = processedText.slice(colonIndex + 1).trimStart();
    }
  }

  // Remove URLs that point to the tweet's own media
  // Pattern: https://t.co/XXXX followed by end of string
  // First, identify if the last part of the tweet is a t.co URL
  const tcoUrlPattern = /https:\/\/t\.co\/\w+$/;
  const tcoMatch = processedText.match(tcoUrlPattern);
  
  if (tcoMatch) {
    // This likely points to media or a quoted tweet, so remove it
    processedText = processedText.replace(tcoMatch[0], '').trim();
  }
  
  // Alternative approach: if we know the tweet's ID, we can look for URLs that reference it
  if (tweetId) {
    const selfReferencePattern = new RegExp(`https://(?:x\\.com|twitter\\.com)/[^/]+/status/${tweetId}/(?:photo|video)/\\d+`, 'g');
    processedText = processedText.replace(selfReferencePattern, '').trim();
  }

  return processedText;
};

export const extractMediaForTweet = async (
  tweet: any,
  allMedia: any[] | undefined
): Promise<IMedia[]> => {
  const mediaItems: MediaItem[] = [];

  // Check if the tweet has attachments with media_keys
  if (!tweet.attachments?.media_keys) return mediaItems;

  for (const mediaKey of tweet.attachments.media_keys) {
    const media = allMedia?.find((m) => m.media_key === mediaKey);

    if (media && media.type === "photo") {
      const item: MediaItem = {
        media_key: media.media_key,
        type: media.type,
        url: media.url,
      };
      mediaItems.push(item); // ✅ Add photo item
    } else if (media && media.type === "video") {
      const item: MediaItem = {
        media_key: media.media_key,
        type: media.type,
        url: media.preview_image_url, // Use preview image for video
      };
      mediaItems.push(item); // ✅ Add video item
    }
  }

  return mediaItems; // ✅ Now correctly after the loop
};

export const processTweet = async (
  tweet: any,
  io: Server,
  allMedia?: any[]
) => {
  try {
    // Extract author info
    const authorId = tweet.author_id;
    const user = await Author.findOne({ author_id: authorId });

    if (!user) {
      console.log(
        `Author id ${authorId} not foound in the database, skipping author`
      );
      return;
    }

    //process text
    const processedTweetText = await processText(tweet.text, tweet);

    // Extract hashtags
    let hashtags = "";
    if (tweet.entities && tweet.entities.hashtags) {
      hashtags = tweet.entities.hashtags.map((tag: any) => tag.tag).join(", ");
    }

    // Process media
    const mediaList = await extractMediaForTweet(tweet, allMedia);
    console.log("mediaList: ", mediaList)
    const hasVideo = mediaList.some((media) => media.type === "video");

    const existing = await Tweet.findOne({ tweet_id: tweet.id });
    if (existing) return;

    // Create tweet object data
    const tweetData: ITweet = {
      tweet_id: tweet.id,
      author_id: authorId,
      text: processedTweetText,
      username: user.username,
      media: mediaList,
      hashtags: hashtags,
      profile_image_url: user.profile_image_url,
      retweet_count: tweet.public_metrics?.retweet_count || 0,
      like_count: tweet.public_metrics?.like_count || 0,
      reply_count: tweet.public_metrics?.reply_count || 0,
      quote_count: tweet.public_metrics?.quote_count || 0,
      hasVideo: hasVideo,
      created_at: tweet.created_at,
    };

    // Create tweet object to save
    const tweetToSave = new Tweet(tweetData);

    // Save to database
    await tweetToSave.save();
    console.log(`Saved tweet: ${tweet.id} from @${user.username}`);

    return tweetToSave;
  } catch (error) {
    console.error("Error processing tweet:", error);
  }
};

import axios from "axios";
import { IMedia, MediaItem, ITweet } from "./interfaces";
import { Tweet } from "../models/tweet.model";
import { Server } from "socket.io";
import { Author } from "../models/author.model";
import { Cashtag } from "../models/cashtag.model";
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
    const decoded = decodeURIComponent(rawDate.replace(/\+/g, " "));

    const date = new Date(decoded);

    if (isNaN(date.getTime())) {
      throw new Error("Invalid date format");
    }

    return date.toISOString();
  } catch (error) {
    console.error("Failed to parse date:", error);
    return null;
  }
};

export const extractCashtags = (text: string): string[] => {
  const cashtagPattern = /\$[A-Z]{1,6}(?:\.[A-Z]{1,4})?/g;
  const cashtags = text.match(cashtagPattern);

  if (!cashtags) return [];

  // Remove duplicates and clean up
  return [...new Set(cashtags.map((tag) => tag.toUpperCase()))];
};

// New function to update cashtag tracking
export const updateCashtagTracking = async (
  cashtags: string[],
  authorId: string,
  username: string,
  tweetId: string,
  tweetDate: Date
) => {
  try {
    for (const cashtag of cashtags) {
      // Find existing cashtag document
      let cashtagDoc = await Cashtag.findOne({ cashtag });

      if (!cashtagDoc) {
        // Create new cashtag document
        cashtagDoc = new Cashtag({
          cashtag,
          mention_count: 1,
          first_mentioned: tweetDate,
          last_mentioned: tweetDate,
          mentioned_by: [
            {
              author_id: authorId,
              username,
              mention_count: 1,
              last_mentioned: tweetDate,
            },
          ],
        });
      } else {
        // Update existing cashtag
        cashtagDoc.mention_count += 1;
        cashtagDoc.last_mentioned = tweetDate;

        // Find if this author has mentioned this cashtag before
        const existingAuthor = cashtagDoc.mentioned_by.find(
          (author) => author.author_id === authorId
        );

        if (existingAuthor) {
          // Update existing author's mention count
          existingAuthor.mention_count += 1;
          existingAuthor.last_mentioned = tweetDate;
        } else {
          // Add new author to the mentioned_by array
          cashtagDoc.mentioned_by.push({
            author_id: authorId,
            username,
            mention_count: 1,
            last_mentioned: tweetDate,
          });
        }
      }

      await cashtagDoc.save();
    }
  } catch (error) {
    console.error("Error updating cashtag tracking:", error);
  }
};

// New function to get cashtag statistics
export const getCashtagStats = async (cashtag?: string) => {
  try {
    if (cashtag) {
      // Get stats for a specific cashtag
      const cashtagDoc = await Cashtag.findOne({
        cashtag: cashtag.toUpperCase(),
      });
      return cashtagDoc;
    } else {
      // Get all cashtags sorted by mention count
      const cashtags = await Cashtag.find({})
        .sort({ mention_count: -1 })
        .limit(50);
      return cashtags;
    }
  } catch (error) {
    console.error("Error getting cashtag stats:", error);
    return null;
  }
};

// New function to get top mentioners for a cashtag
export const getTopMentioners = async (cashtag: string, limit: number = 10) => {
  try {
    const cashtagDoc = await Cashtag.findOne({
      cashtag: cashtag.toUpperCase(),
    });

    if (!cashtagDoc) return [];

    return cashtagDoc.mentioned_by
      .sort((a, b) => b.mention_count - a.mention_count)
      .slice(0, limit);
  } catch (error) {
    console.error("Error getting top mentioners:", error);
    return [];
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
    console.log("error fetching tweets from list", error.response.data);
    return {
      tweets: [],
      includes: [],
    };
  }
};

export const processText = async (tweetText: string, tweetId: string) => {
  let processedText = tweetText;
  if (processedText.startsWith("RT")) {
    processedText = processedText.slice(3);
    const colonIndex = processedText.indexOf(":");
    if (colonIndex !== -1 && processedText.startsWith("@")) {
      processedText = processedText.slice(colonIndex + 1).trimStart();
    }
  }

  const tcoUrlPattern = /https:\/\/t\.co\/\w+$/;
  const tcoMatch = processedText.match(tcoUrlPattern);

  if (tcoMatch) {
    processedText = processedText.replace(tcoMatch[0], "").trim();
  }

  if (tweetId) {
    const selfReferencePattern = new RegExp(
      `https://(?:x\\.com|twitter\\.com)/[^/]+/status/${tweetId}/(?:photo|video)/\\d+`,
      "g"
    );
    processedText = processedText.replace(selfReferencePattern, "").trim();
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
        `Author id ${authorId} not found in the database, skipping author`
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

    // Extract cashtags from the tweet text
    const cashtags = extractCashtags(tweet.text);
    const cashtagsString = cashtags.join(", ");

    // Process media
    const mediaList = await extractMediaForTweet(tweet, allMedia);
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
      cashtags: cashtagsString, // Add cashtags to tweet data
      profile_image_url: user.profile_image_url,
      retweet_count: tweet.public_metrics?.retweet_count || 0,
      like_count: tweet.public_metrics?.like_count || 0,
      reply_count: tweet.public_metrics?.reply_count || 0,
      quote_count: tweet.public_metrics?.quote_count || 0,
      hasVideo: hasVideo,
      created_at: tweet.created_at,
    };

    const tweetToSave = new Tweet(tweetData);

    try {
      await tweetToSave.save();

      // Update cashtag tracking after successfully saving the tweet
      if (cashtags.length > 0) {
        await updateCashtagTracking(
          cashtags,
          authorId,
          user.username,
          tweet.id,
          new Date(tweet.created_at)
        );
      }

      return tweetData;
    } catch (saveError) {
      console.error(`Failed to save tweet ${tweet.id}:`, saveError);
      throw saveError;
    }
  } catch (error) {
    console.error("Error processing tweet:", error);
  }
};

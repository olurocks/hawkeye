// twitterClient.ts - Modified to accept socket.io instance
import { X_API_KEY, X_API_SECRET, BEARER_TOKEN } from "./src/utils/constants";
import { Tweet } from "./src/models/tweet.model";
import { ITweet } from "./src/utils/interfaces";
import mongoose from "mongoose";
import { Server } from "socket.io";
const needle = require("needle");

const token = BEARER_TOKEN;

if (!token) {
  console.error("No Twitter bearer token provided in environment variables");
  process.exit(1);
}

const accountsToTrack = [
  "elonmusk",
  "BillGates",
  "BarackObama",
  // Add more accounts as needed
];

// Function to get user IDs from usernames
async function getUserIds(usernames: string[]) {
  try {
    const url = `https://api.twitter.com/2/users/by?usernames=${usernames.join(
      ","
    )}&user.fields=profile_image_url`;
    const response = await needle("get", url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.statusCode !== 200) {
      throw new Error(
        `Request failed with status ${response.statusCode}: ${response.body}`
      );
    }

    return response.body.data.map((user: any) => ({
      id: user.id,
      username: user.username,
      profile_image_url: user.profile_image_url,
    }));
  } catch (error) {
    console.error("Error fetching user IDs:", error);
    return [];
  }
}

// Set up rules for the stream
async function setRules(userIds: any) {
  const rulesURL = "https://api.twitter.com/2/tweets/search/stream/rules";

  // First, delete existing rules
  try {
    const currentRules = await needle("get", rulesURL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (
      currentRules.body &&
      currentRules.body.data &&
      currentRules.body.data.length > 0
    ) {
      const ids = currentRules.body.data.map((rule: any) => rule.id);
      await needle(
        "post",
        rulesURL,
        {
          delete: { ids },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
    }
  } catch (error) {
    console.error("Error deleting rules:", error);
  }

  // Now add new rules based on user IDs
  const rules = userIds.map((user: any) => ({
    value: `from:${user.id}`,
    tag: `tweets from ${user.username}`,
  }));

  try {
    const response = await needle(
      "post",
      rulesURL,
      {
        add: rules,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.statusCode !== 201) {
      const errorDetails = JSON.stringify(response.body, null, 2);
      throw new Error(
        `Rules creation failed (${response.statusCode}): ${errorDetails}`
      );
    }

    return response.body;
  } catch (error) {
    console.error("Error setting rules:", error);
    throw error;
  }
}

// Function to process and save tweets
async function processTweet(tweet: any, userMap: any, io: Server) {
  try {
    // Extract author info
    const authorId = tweet.data.author_id;
    const user = userMap.find((u: any) => u.id === authorId);

    if (!user) {
      console.log(`User not found for author_id: ${authorId}`);
      return;
    }

    // Extract hashtags
    const hashtags: string[] = [];
    if (tweet.data.entities && tweet.data.entities.hashtags) {
      tweet.data.entities.hashtags.forEach((tag: any) => {
        hashtags.push(tag.tag);
      });
    }

    // Process media
    const mediaArray: any[] = [];
    let hasVideo = false;

    if (tweet.includes && tweet.includes.media) {
      tweet.includes.media.forEach((media: any) => {
        const mediaItem = {
          media_key: media.media_key,
          type: media.type,
          url: media.type === "photo" ? media.url : null,
        };

        if (media.type === "video" || media.type === "animated_gif") {
          hasVideo = true;
        }

        mediaArray.push(mediaItem);
      });
    }

    // Create tweet object data
    const tweetData: ITweet = {
      tweet_id: tweet.data.id,
      author_id: authorId,
      text: tweet.data.text,
      username: user.username,
      media: mediaArray,
      hashtags: "hashtags",
      profile_image_url: user.profile_image_url,
      retweet_count: tweet.data.public_metrics?.retweet_count || 0,
      like_count: tweet.data.public_metrics?.like_count || 0,
      reply_count: tweet.data.public_metrics?.reply_count || 0,
      quote_count: tweet.data.public_metrics?.quote_count || 0,
      hasVideo: hasVideo,
      created_at: tweet.data.created_at,
    };

    // Create tweet object to save
    const tweetToSave = new Tweet(tweetData);

    // Save to database
    await tweetToSave.save();
    console.log(`Saved tweet: ${tweet.data.id} from @${user.username}`);

    // Emit to all connected clients
    io.emit("new_tweet", tweetData);
    console.log(
      `Emitted new tweet: ${tweetData.tweet_id} from @${tweetData.username}`
    );
  } catch (error) {
    console.error("Error processing tweet:", error);
  }
}

function connectStream(userMap: any, io: Server) {
  const streamURL = "https://api.twitter.com/2/tweets/search/stream";
  const params = {
    "tweet.fields": "created_at,public_metrics,entities",
    expansions: "author_id,attachments.media_keys",
    "media.fields":
      "duration_ms,height,media_key,preview_image_url,type,url,width,public_metrics",
  };

  const stream = needle.get(streamURL, params, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 0, // No timeout
  });

  stream
    .on("data", async (data: any) => {
      try {
        const json = JSON.parse(data);
        if (json.data) {
          await processTweet(json, userMap, io);
        } else if (json.errors) {
          console.error("Error from Twitter API:", json.errors);
        }
      } catch (error) {
        // In case data is not a valid JSON, just skip it
        if (data.length > 1) {
          console.error("Error parsing stream data:", error);
        }
      }
    })
    .on("error", (error: any) => {
      console.error("Stream error:", error);
      setTimeout(() => connectStream(userMap, io), 5000); // Try to reconnect after 5 seconds
    })
    .on("end", () => {
      console.log("Stream connection ended");
      setTimeout(() => connectStream(userMap, io), 5000); // Try to reconnect after 5 seconds
    });

  return stream;
}

export async function startTwitterStream(io: Server) {
  try {
    console.log("Starting Twitter stream...");

    // Get user IDs from usernames
    const userMap = await getUserIds(accountsToTrack);
    if (userMap.length === 0) {
      throw new Error("Failed to get user IDs");
    }

    // Set up stream rules
    await setRules(userMap);

    // Connect to the stream with socket.io passed in
    connectStream(userMap, io);

    console.log(`Monitoring tweets from: ${accountsToTrack.join(", ")}`);
    return true;
  } catch (error) {
    console.error("Error in Twitter stream:", error);
    throw error;
  }
}

export interface IMedia {
  media_key: string;
  type: string;
  urls?: string[];
  preview_image_url?: string;
  alt_text?: string;
}


const testData= {
    "data": [
        {
            "created_at": "2025-05-18T19:59:00.000Z",
            "edit_history_tweet_ids": [
                "1924193019622052313"
            ],
            "id": "1924193019622052313",
            "public_metrics": {
                "retweet_count": 3,
                "reply_count": 31,
                "like_count": 63,
                "quote_count": 4,
                "bookmark_count": 3,
                "impression_count": 891
            },
            "author_id": "913220981572931584",
            "text": "You may need 1 year.\n\nYou may need 3 years.\n\nYou may need 5 years.\n\nBut eventually, you're gonna make it.\n\nDon't give up."
        },
        {
            "created_at": "2025-05-18T19:57:33.000Z",
            "edit_history_tweet_ids": [
                "1924192656579588510"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 3,
                        "end": 8,
                        "probability": 0.4078,
                        "type": "Organization",
                        "normalized_text": "Hosico"
                    },
                    {
                        "start": 43,
                        "end": 49,
                        "probability": 0.7146,
                        "type": "Other",
                        "normalized_text": "FITCOIN"
                    },
                    {
                        "start": 118,
                        "end": 121,
                        "probability": 0.4739,
                        "type": "Other",
                        "normalized_text": "MOBY"
                    },
                    {
                        "start": 256,
                        "end": 259,
                        "probability": 0.473,
                        "type": "Other",
                        "normalized_text": "gork"
                    }
                ],
                "cashtags": [
                    {
                        "start": 2,
                        "end": 9,
                        "tag": "Hosico"
                    },
                    {
                        "start": 117,
                        "end": 122,
                        "tag": "MOBY"
                    },
                    {
                        "start": 255,
                        "end": 260,
                        "tag": "gork"
                    }
                ],
                "mentions": [
                    {
                        "start": 123,
                        "end": 133,
                        "username": "mobyagent",
                        "id": "1878834956891299841"
                    }
                ]
            },
            "id": "1924192656579588510",
            "public_metrics": {
                "retweet_count": 0,
                "reply_count": 2,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 1,
                "impression_count": 614
            },
            "author_id": "1854960382097735681",
            "text": "A $Hosico cat whale just bought $4.91K of $FITCOIN at $9.75M MC 🐳\n\n30 Day Insights on this specific whale powered by $MOBY @mobyagent:\n🔹 Win Rate: 91.84%\n🔹 Total Trades: 1459\n🔹 PnL: Positive\n🔹 Average Trade: $11.13K\n🔹 Total Volume: $16.23M\n🔹 Biggest Win: $gork"
        },
        {
            "created_at": "2025-05-18T19:56:25.000Z",
            "edit_history_tweet_ids": [
                "1924192369823580410"
            ],
            "id": "1924192369823580410",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 36,
                "like_count": 29,
                "quote_count": 1,
                "bookmark_count": 0,
                "impression_count": 677
            },
            "author_id": "1464764111720493056",
            "text": "GM TO ALL THE BULLS OUT THERE.\n\nWERE ALL GONNA BE DISGUSTINGLY RICH."
        },
        {
            "created_at": "2025-05-18T19:54:16.000Z",
            "edit_history_tweet_ids": [
                "1924191829295046759"
            ],
            "id": "1924191829295046759",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 71,
                "like_count": 53,
                "quote_count": 2,
                "bookmark_count": 0,
                "impression_count": 2394
            },
            "author_id": "2760158505",
            "text": "What we pvpin today fam?"
        },
        {
            "created_at": "2025-05-18T19:49:59.000Z",
            "edit_history_tweet_ids": [
                "1924190752403337649"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 39,
                        "end": 62,
                        "url": "https://t.co/oJoKli06qh",
                        "expanded_url": "http://Time.fun",
                        "display_url": "Time.fun",
                        "status": 200,
                        "title": "Time.fun",
                        "description": "Trade and redeem minutes to connect with your favorite creators",
                        "unwound_url": "https://time.fun/explore"
                    },
                    {
                        "start": 69,
                        "end": 92,
                        "url": "https://t.co/5vtbFe3aYJ",
                        "expanded_url": "https://x.com/Soljakeyupdates/status/1924180513297727897/video/1",
                        "display_url": "pic.x.com/5vtbFe3aYJ",
                        "media_key": "13_1924180387703533568"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 19,
                        "username": "Soljakeyupdates",
                        "id": "1909674936811085824"
                    }
                ]
            },
            "attachments": {
                "media_source_tweet_id": [
                    "1924180513297727897"
                ],
                "media_keys": [
                    "13_1924180387703533568"
                ]
            },
            "id": "1924190752403337649",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1502733964808650754",
            "text": "RT @Soljakeyupdates: Breaking down how https://t.co/oJoKli06qh works https://t.co/5vtbFe3aYJ"
        },
        {
            "created_at": "2025-05-18T19:48:25.000Z",
            "edit_history_tweet_ids": [
                "1924190358524563944"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 3,
                        "end": 10,
                        "probability": 0.5514,
                        "type": "Other",
                        "normalized_text": "FARTCOIN"
                    },
                    {
                        "start": 41,
                        "end": 48,
                        "probability": 0.5042,
                        "type": "Other",
                        "normalized_text": "TRENCHER"
                    },
                    {
                        "start": 117,
                        "end": 120,
                        "probability": 0.4494,
                        "type": "Other",
                        "normalized_text": "MOBY"
                    }
                ],
                "cashtags": [
                    {
                        "start": 116,
                        "end": 121,
                        "tag": "MOBY"
                    },
                    {
                        "start": 251,
                        "end": 257,
                        "tag": "House"
                    }
                ],
                "mentions": [
                    {
                        "start": 122,
                        "end": 132,
                        "username": "mobyagent",
                        "id": "1878834956891299841"
                    }
                ]
            },
            "id": "1924190358524563944",
            "public_metrics": {
                "retweet_count": 0,
                "reply_count": 10,
                "like_count": 2,
                "quote_count": 1,
                "bookmark_count": 0,
                "impression_count": 1365
            },
            "author_id": "1854960382097735681",
            "text": "A $FARTCOIN whale just bought $3.17K of $TRENCHER at $2.70M MC 🐳\n\n30 Day Insights on this specific whale powered by $MOBY @mobyagent:\n🔹 Win Rate: 38.03%\n🔹 Total Trades: 234\n🔹 PnL: Positive\n🔹 Average Trade: $5.47K\n🔹 Total Volume: $1.28M\n🔹 Biggest Win: $House"
        },
        {
            "created_at": "2025-05-18T19:45:04.000Z",
            "edit_history_tweet_ids": [
                "1924189514647347434"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 36,
                        "end": 59,
                        "url": "https://t.co/Scgr9KSlOc",
                        "expanded_url": "https://x.com/McDonaldsXBT/status/1924188801145971151/photo/1",
                        "display_url": "pic.x.com/Scgr9KSlOc",
                        "media_key": "3_1924188790182055936"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 16,
                        "username": "McDonaldsXBT",
                        "id": "1491868310253842433"
                    }
                ]
            },
            "attachments": {
                "media_source_tweet_id": [
                    "1924188801145971151"
                ],
                "media_keys": [
                    "3_1924188790182055936"
                ]
            },
            "id": "1924189514647347434",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @McDonaldsXBT: Tuned in\n\nGo nugs https://t.co/Scgr9KSlOc"
        },
        {
            "created_at": "2025-05-18T19:45:03.000Z",
            "edit_history_tweet_ids": [
                "1924189508540448937"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 69,
                        "end": 74,
                        "probability": 0.6236,
                        "type": "Other",
                        "normalized_text": "Solana"
                    },
                    {
                        "start": 77,
                        "end": 83,
                        "probability": 0.8585,
                        "type": "Other",
                        "normalized_text": "Eclipse"
                    },
                    {
                        "start": 90,
                        "end": 92,
                        "probability": 0.7701,
                        "type": "Other",
                        "normalized_text": "Sui"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 11,
                        "username": "smyyguy",
                        "id": "424304399"
                    }
                ]
            },
            "id": "1924189508540448937",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @smyyguy: What chains are focused on local fee markets other than Solana, Eclipse, and Sui?"
        },
        {
            "created_at": "2025-05-18T19:44:48.000Z",
            "edit_history_tweet_ids": [
                "1924189445751963678"
            ],
            "id": "1924189445751963678",
            "public_metrics": {
                "retweet_count": 12,
                "reply_count": 16,
                "like_count": 77,
                "quote_count": 0,
                "bookmark_count": 2,
                "impression_count": 3495
            },
            "author_id": "1054149844384669696",
            "text": "If the product is the market cap — \nand demand and supply is how it works: \n\nThe team buying back and burning the supply with liquidity fees creates supply pressure. \n\nI.e. Improving the product daily.\n\nFor a startup that does nothing, we have the best product-market(cap) fit."
        },
        {
            "created_at": "2025-05-18T19:43:48.000Z",
            "edit_history_tweet_ids": [
                "1924189196370977200"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 19,
                        "end": 24,
                        "probability": 0.9834,
                        "type": "Other",
                        "normalized_text": "Tiktok"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 17,
                        "username": "OmniLaunchApp",
                        "id": "1923771281884971013"
                    }
                ]
            },
            "id": "1924189196370977200",
            "public_metrics": {
                "retweet_count": 26,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1397323152053530626",
            "text": "RT @OmniLaunchApp: Tiktok integration coming up next on our list. Will keep the everyone posted on our progress. Excited to see what y'all…"
        },
        {
            "created_at": "2025-05-18T19:40:27.000Z",
            "edit_history_tweet_ids": [
                "1924188351998959838"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 3,
                        "end": 11,
                        "probability": 0.6472,
                        "type": "Other",
                        "normalized_text": "Housecoin"
                    },
                    {
                        "start": 116,
                        "end": 119,
                        "probability": 0.5837,
                        "type": "Other",
                        "normalized_text": "MOBY"
                    }
                ],
                "cashtags": [
                    {
                        "start": 41,
                        "end": 47,
                        "tag": "House"
                    },
                    {
                        "start": 115,
                        "end": 120,
                        "tag": "MOBY"
                    },
                    {
                        "start": 250,
                        "end": 256,
                        "tag": "House"
                    }
                ],
                "mentions": [
                    {
                        "start": 121,
                        "end": 131,
                        "username": "mobyagent",
                        "id": "1878834956891299841"
                    }
                ]
            },
            "id": "1924188351998959838",
            "public_metrics": {
                "retweet_count": 0,
                "reply_count": 8,
                "like_count": 3,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 1611
            },
            "author_id": "1854960382097735681",
            "text": "A $Housecoin whale just bought $8.38K of $House at $34.17M MC 🐳\n\n30 Day Insights on this specific whale powered by $MOBY @mobyagent:\n🔹 Win Rate: 91.70%\n🔹 Total Trades: 554\n🔹 PnL: Positive\n🔹 Average Trade: $9.00K\n🔹 Total Volume: $4.98M\n🔹 Biggest Win: $House"
        },
        {
            "created_at": "2025-05-18T19:39:00.000Z",
            "edit_history_tweet_ids": [
                "1924187986532729307"
            ],
            "id": "1924187986532729307",
            "public_metrics": {
                "retweet_count": 3,
                "reply_count": 66,
                "like_count": 88,
                "quote_count": 5,
                "bookmark_count": 2,
                "impression_count": 4659
            },
            "author_id": "913220981572931584",
            "text": "how is the average american worker expected to buy a home? genuinely curious."
        },
        {
            "created_at": "2025-05-18T19:37:09.000Z",
            "edit_history_tweet_ids": [
                "1924187523342803291"
            ],
            "entities": {
                "cashtags": [
                    {
                        "start": 15,
                        "end": 20,
                        "tag": "time"
                    }
                ],
                "mentions": [
                    {
                        "start": 0,
                        "end": 14,
                        "username": "LexaproTrader",
                        "id": "1497133752278999066"
                    }
                ]
            },
            "id": "1924187523342803291",
            "public_metrics": {
                "retweet_count": 0,
                "reply_count": 0,
                "like_count": 1,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 92
            },
            "author_id": "950525897618096128",
            "text": "@LexaproTrader $time will tell"
        },
        {
            "created_at": "2025-05-18T19:36:02.000Z",
            "edit_history_tweet_ids": [
                "1924187242630910113"
            ],
            "id": "1924187242630910113",
            "public_metrics": {
                "retweet_count": 3,
                "reply_count": 126,
                "like_count": 124,
                "quote_count": 1,
                "bookmark_count": 1,
                "impression_count": 6618
            },
            "author_id": "1497133752278999066",
            "text": "The answer is to shill more CAs, not less"
        },
        {
            "created_at": "2025-05-18T19:32:00.000Z",
            "edit_history_tweet_ids": [
                "1924186225918743004"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 111,
                        "end": 116,
                        "probability": 0.5706,
                        "type": "Other",
                        "normalized_text": "crypto"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 13,
                        "username": "theunipcs",
                        "id": "1755899659040555009"
                    }
                ]
            },
            "id": "1924186225918743004",
            "public_metrics": {
                "retweet_count": 54,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1755899659040555009",
            "text": "RT @theunipcs: almost every major memecoin this cycle has been born when the atmosphere in the trenches, or in crypto as a whole, seemed co…"
        },
        {
            "created_at": "2025-05-18T19:31:10.000Z",
            "edit_history_tweet_ids": [
                "1924186017659027848"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 23,
                        "end": 26,
                        "probability": 0.7559,
                        "type": "Person",
                        "normalized_text": "bonk"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 18,
                        "username": "LarrytheOracle",
                        "id": "226071254"
                    }
                ]
            },
            "id": "1924186017659027848",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1755899659040555009",
            "text": "RT @LarrytheOracle: If bonk guy is getting so much hate it is because folks that are hating on him have been waiting for a chance to - the…"
        },
        {
            "created_at": "2025-05-18T19:31:01.000Z",
            "edit_history_tweet_ids": [
                "1924185979583086802"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 82,
                        "end": 89,
                        "probability": 0.9595,
                        "type": "Place",
                        "normalized_text": "Portugal"
                    }
                ]
            },
            "id": "1924185979583086802",
            "public_metrics": {
                "retweet_count": 5,
                "reply_count": 25,
                "like_count": 48,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 2621
            },
            "author_id": "885331587310735360",
            "text": "Huge defeat for socialists today in the Portuguese elections \n\nBut a huge win for Portugal"
        },
        {
            "created_at": "2025-05-18T19:30:36.000Z",
            "edit_history_tweet_ids": [
                "1924185874599698510"
            ],
            "entities": {
                "mentions": [
                    {
                        "start": 3,
                        "end": 14,
                        "username": "GCrypto768",
                        "id": "1737453861625860096"
                    },
                    {
                        "start": 94,
                        "end": 104,
                        "username": "theunipcs",
                        "id": "1755899659040555009"
                    }
                ]
            },
            "id": "1924185874599698510",
            "public_metrics": {
                "retweet_count": 3,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1755899659040555009",
            "text": "RT @GCrypto768: You either die a hero or live long enough to become a villain 😂\n\nJokes aside, @theunipcs seems like a straight up G and giv…"
        },
        {
            "created_at": "2025-05-18T19:30:21.000Z",
            "edit_history_tweet_ids": [
                "1924185810904973787"
            ],
            "entities": {
                "mentions": [
                    {
                        "start": 3,
                        "end": 12,
                        "username": "KSimback",
                        "id": "3108019343"
                    }
                ]
            },
            "id": "1924185810904973787",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1755899659040555009",
            "text": "RT @KSimback: A couple things I’ve learned about ‘bonk guy’ that make me wonder why he gets all this fud\n\n1. He’s extremely thoughtful w hi…"
        },
        {
            "created_at": "2025-05-18T19:29:46.000Z",
            "edit_history_tweet_ids": [
                "1924185665635238018"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 37,
                        "end": 44,
                        "probability": 0.7448,
                        "type": "Other",
                        "normalized_text": "fartcoin"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 13,
                        "username": "RickBakas",
                        "id": "14056454"
                    },
                    {
                        "start": 15,
                        "end": 25,
                        "username": "theunipcs",
                        "id": "1755899659040555009"
                    }
                ]
            },
            "id": "1924185665635238018",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1755899659040555009",
            "text": "RT @RickBakas: @theunipcs I got into fartcoin b/c of you and made $$$\n\nI got into useless b/c of you and made $$$\n\nI don’t blindly ape, I d…"
        },
        {
            "created_at": "2025-05-18T19:28:45.000Z",
            "edit_history_tweet_ids": [
                "1924185408771866626"
            ],
            "entities": {
                "mentions": [
                    {
                        "start": 3,
                        "end": 14,
                        "username": "0xForte124",
                        "id": "1447094582181728259"
                    },
                    {
                        "start": 30,
                        "end": 40,
                        "username": "theunipcs",
                        "id": "1755899659040555009"
                    }
                ]
            },
            "id": "1924185408771866626",
            "public_metrics": {
                "retweet_count": 4,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1755899659040555009",
            "text": "RT @0xForte124: Crazy because @theunipcs locked his hosico for multiple months and promised he won’t sell until 100m\n\nHis ‘Useless thesis’…"
        },
        {
            "created_at": "2025-05-18T19:26:14.000Z",
            "edit_history_tweet_ids": [
                "1924184773284757777"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 23,
                        "end": 34,
                        "probability": 0.6659,
                        "type": "Other",
                        "normalized_text": "theranos cex"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 17,
                        "username": "TheranosOnSol",
                        "id": "1922575879751995392"
                    },
                    {
                        "start": 96,
                        "end": 107,
                        "username": "believeapp",
                        "id": "1849494185151168512"
                    }
                ]
            },
            "id": "1924184773284757777",
            "public_metrics": {
                "retweet_count": 18,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1325739682752204800",
            "text": "RT @TheranosOnSol: The theranos cex wallet has accumulated ~ 3.75% of supply ($180,000) and the @believeapp protocol fee wallet has accumul…"
        },
        {
            "created_at": "2025-05-18T19:25:04.000Z",
            "edit_history_tweet_ids": [
                "1924184481973321855"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 11,
                        "end": 34,
                        "url": "https://t.co/7yrXFMlrgm",
                        "expanded_url": "https://x.com/icebergy_/status/1924184481973321855/photo/1",
                        "display_url": "pic.x.com/7yrXFMlrgm",
                        "media_key": "3_1924184257766776832"
                    },
                    {
                        "start": 35,
                        "end": 58,
                        "url": "https://t.co/LLPNSYlr26",
                        "expanded_url": "https://twitter.com/TheEconomist/status/1923000491488784762",
                        "display_url": "x.com/TheEconomist/s…"
                    }
                ]
            },
            "id": "1924184481973321855",
            "public_metrics": {
                "retweet_count": 4,
                "reply_count": 22,
                "like_count": 81,
                "quote_count": 0,
                "bookmark_count": 3,
                "impression_count": 5892
            },
            "author_id": "239518063",
            "text": "we're safe https://t.co/7yrXFMlrgm https://t.co/LLPNSYlr26",
            "attachments": {
                "media_keys": [
                    "3_1924184257766776832"
                ]
            }
        },
        {
            "created_at": "2025-05-18T19:20:25.000Z",
            "edit_history_tweet_ids": [
                "1924183311494025585"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 7,
                        "end": 30,
                        "url": "https://t.co/LUSKGEdJlB",
                        "expanded_url": "https://x.com/SolJakey/status/1924183311494025585/photo/1",
                        "display_url": "pic.x.com/LUSKGEdJlB",
                        "media_key": "3_1924183305940791296"
                    }
                ]
            },
            "id": "1924183311494025585",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 85,
                "like_count": 143,
                "quote_count": 1,
                "bookmark_count": 6,
                "impression_count": 5793
            },
            "author_id": "1502733964808650754",
            "text": "Facts. https://t.co/LUSKGEdJlB",
            "attachments": {
                "media_keys": [
                    "3_1924183305940791296"
                ]
            }
        },
        {
            "created_at": "2025-05-18T19:19:35.000Z",
            "edit_history_tweet_ids": [
                "1924183100092776799"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 37,
                        "end": 40,
                        "probability": 0.5456,
                        "type": "Person",
                        "normalized_text": "bonk"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 17,
                        "username": "notanicecat69",
                        "id": "1506635279649722381"
                    }
                ]
            },
            "id": "1924183100092776799",
            "public_metrics": {
                "retweet_count": 21,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "1755899659040555009",
            "text": "RT @notanicecat69: everyone’s mad at bonk guy for shilling multiple tickers, claiming it’s moving liquidity around and it’s wrecking people…"
        },
        {
            "created_at": "2025-05-18T19:17:24.000Z",
            "edit_history_tweet_ids": [
                "1924182550471188762"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 3,
                        "end": 11,
                        "probability": 0.6694,
                        "type": "Other",
                        "normalized_text": "Housecoin"
                    },
                    {
                        "start": 116,
                        "end": 119,
                        "probability": 0.5839,
                        "type": "Other",
                        "normalized_text": "MOBY"
                    }
                ],
                "cashtags": [
                    {
                        "start": 41,
                        "end": 47,
                        "tag": "House"
                    },
                    {
                        "start": 115,
                        "end": 120,
                        "tag": "MOBY"
                    },
                    {
                        "start": 250,
                        "end": 256,
                        "tag": "House"
                    }
                ],
                "mentions": [
                    {
                        "start": 121,
                        "end": 131,
                        "username": "mobyagent",
                        "id": "1878834956891299841"
                    }
                ]
            },
            "id": "1924182550471188762",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 8,
                "like_count": 7,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 2303
            },
            "author_id": "1854960382097735681",
            "text": "A $Housecoin whale just bought $4.99K of $House at $34.62M MC 🐳\n\n30 Day Insights on this specific whale powered by $MOBY @mobyagent:\n🔹 Win Rate: 38.80%\n🔹 Total Trades: 250\n🔹 PnL: Positive\n🔹 Average Trade: $5.13K\n🔹 Total Volume: $1.28M\n🔹 Biggest Win: $House"
        },
        {
            "created_at": "2025-05-18T19:17:03.000Z",
            "edit_history_tweet_ids": [
                "1924182462051070372"
            ],
            "entities": {
                "mentions": [
                    {
                        "start": 3,
                        "end": 15,
                        "username": "Pir8teAngel",
                        "id": "1442281799212679173"
                    }
                ]
            },
            "id": "1924182462051070372",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "986900699366604800",
            "text": "RT @Pir8teAngel: How can there be a CTO on a 15 minute old coin?"
        },
        {
            "created_at": "2025-05-18T19:13:14.000Z",
            "edit_history_tweet_ids": [
                "1924181503849726422"
            ],
            "entities": {
                "mentions": [
                    {
                        "start": 3,
                        "end": 16,
                        "username": "startuponsol",
                        "id": "1922313038667169792"
                    }
                ]
            },
            "id": "1924181503849726422",
            "public_metrics": {
                "retweet_count": 19,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 1
            },
            "author_id": "1054149844384669696",
            "text": "RT @startuponsol: Startup continues to buy and take startup tokens permanently out of circulation while also providing members in the cap t…"
        },
        {
            "created_at": "2025-05-18T19:11:16.000Z",
            "edit_history_tweet_ids": [
                "1924181006879183053"
            ],
            "id": "1924181006879183053",
            "public_metrics": {
                "retweet_count": 12,
                "reply_count": 122,
                "like_count": 113,
                "quote_count": 1,
                "bookmark_count": 0,
                "impression_count": 5884
            },
            "author_id": "928060984379441152",
            "text": "If you could buy ur time back \n\nwould you? \n\nand what’s the most you would pay"
        },
        {
            "created_at": "2025-05-18T19:11:10.000Z",
            "edit_history_tweet_ids": [
                "1924180984108392480"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 80,
                        "end": 103,
                        "url": "https://t.co/SWe7pTBL0D",
                        "expanded_url": "https://x.com/SuperteamCAN/status/1924169598166769774/video/1",
                        "display_url": "pic.x.com/SWe7pTBL0D",
                        "media_key": "13_1924167808281190400"
                    }
                ],
                "annotations": [
                    {
                        "start": 18,
                        "end": 31,
                        "probability": 0.6504,
                        "type": "Other",
                        "normalized_text": "Solana Startup"
                    },
                    {
                        "start": 41,
                        "end": 47,
                        "probability": 0.8984,
                        "type": "Place",
                        "normalized_text": "Toronto"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 16,
                        "username": "SuperteamCAN",
                        "id": "1785295555775680512"
                    }
                ]
            },
            "attachments": {
                "media_source_tweet_id": [
                    "1924169598166769774"
                ],
                "media_keys": [
                    "13_1924167808281190400"
                ]
            },
            "id": "1924180984108392480",
            "public_metrics": {
                "retweet_count": 36,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "951329744804392960",
            "text": "RT @SuperteamCAN: Solana Startup Village Toronto just stamped its mark on Web3🍁 https://t.co/SWe7pTBL0D"
        },
        {
            "created_at": "2025-05-18T19:08:40.000Z",
            "edit_history_tweet_ids": [
                "1924180351561150760"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 3,
                        "end": 6,
                        "probability": 0.5548,
                        "type": "Other",
                        "normalized_text": "FWOG"
                    },
                    {
                        "start": 37,
                        "end": 40,
                        "probability": 0.7528,
                        "type": "Other",
                        "normalized_text": "FWOG"
                    },
                    {
                        "start": 110,
                        "end": 113,
                        "probability": 0.4956,
                        "type": "Other",
                        "normalized_text": "MOBY"
                    },
                    {
                        "start": 248,
                        "end": 255,
                        "probability": 0.4232,
                        "type": "Other",
                        "normalized_text": "LetsBONK"
                    }
                ],
                "cashtags": [
                    {
                        "start": 2,
                        "end": 7,
                        "tag": "FWOG"
                    },
                    {
                        "start": 36,
                        "end": 41,
                        "tag": "FWOG"
                    },
                    {
                        "start": 109,
                        "end": 114,
                        "tag": "MOBY"
                    }
                ],
                "mentions": [
                    {
                        "start": 115,
                        "end": 125,
                        "username": "mobyagent",
                        "id": "1878834956891299841"
                    }
                ]
            },
            "id": "1924180351561150760",
            "public_metrics": {
                "retweet_count": 0,
                "reply_count": 10,
                "like_count": 3,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 2185
            },
            "author_id": "1854960382097735681",
            "text": "A $FWOG whale just bought $7.45K of $FWOG at $77.51M MC 🐳\n\n30 Day Insights on this specific whale powered by $MOBY @mobyagent:\n🔹 Win Rate: 12.68%\n🔹 Total Trades: 1199\n🔹 PnL: Negative\n🔹 Average Trade: $20.72K\n🔹 Total Volume: $24.84M\n🔹 Biggest Win: $LetsBONK"
        },
        {
            "created_at": "2025-05-18T19:07:05.000Z",
            "edit_history_tweet_ids": [
                "1924179953735684163"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 37,
                        "end": 60,
                        "url": "https://t.co/XjbJXiSRR6",
                        "expanded_url": "https://x.com/JayChan247/status/1924169807341215799/photo/1",
                        "display_url": "pic.x.com/XjbJXiSRR6",
                        "media_key": "3_1924169800734904320"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 14,
                        "username": "JayChan247",
                        "id": "835407163455504385"
                    }
                ]
            },
            "attachments": {
                "media_source_tweet_id": [
                    "1924169807341215799"
                ],
                "media_keys": [
                    "3_1924169800734904320"
                ]
            },
            "id": "1924179953735684163",
            "public_metrics": {
                "retweet_count": 13,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "986900699366604800",
            "text": "RT @JayChan247: Men Of God \n\nmog/acc https://t.co/XjbJXiSRR6"
        },
        {
            "created_at": "2025-05-18T19:06:48.000Z",
            "edit_history_tweet_ids": [
                "1924179885309727049"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 24,
                        "end": 28,
                        "probability": 0.4755,
                        "type": "Other",
                        "normalized_text": "folio"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 14,
                        "username": "TeTheGamer",
                        "id": "289395584"
                    }
                ]
            },
            "id": "1924179885309727049",
            "public_metrics": {
                "retweet_count": 8,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 1
            },
            "author_id": "1502733964808650754",
            "text": "RT @TeTheGamer: My time.folio is building up nice\n\nLots of improvements and new features coming to the website \n\nI expect these to all go h…"
        },
        {
            "created_at": "2025-05-18T19:00:53.000Z",
            "edit_history_tweet_ids": [
                "1924178395614634410"
            ],
            "id": "1924178395614634410",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 59,
                "like_count": 110,
                "quote_count": 2,
                "bookmark_count": 0,
                "impression_count": 5606
            },
            "author_id": "1262818098035462144",
            "text": "Find the person fucking your crush and fuck them"
        },
        {
            "created_at": "2025-05-18T19:00:09.000Z",
            "edit_history_tweet_ids": [
                "1924178211220672698"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 2,
                        "end": 25,
                        "url": "https://t.co/dcAiMKOylQ",
                        "expanded_url": "https://x.com/shahh/status/1924178211220672698/photo/1",
                        "display_url": "pic.x.com/dcAiMKOylQ",
                        "media_key": "3_1924178208611807233"
                    }
                ]
            },
            "id": "1924178211220672698",
            "public_metrics": {
                "retweet_count": 6,
                "reply_count": 71,
                "like_count": 87,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 3210
            },
            "author_id": "928060984379441152",
            "text": "😭 https://t.co/dcAiMKOylQ",
            "attachments": {
                "media_keys": [
                    "3_1924178208611807233"
                ]
            }
        },
        {
            "created_at": "2025-05-18T18:59:32.000Z",
            "edit_history_tweet_ids": [
                "1924178055838240853"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 108,
                        "end": 111,
                        "probability": 0.7143,
                        "type": "Other",
                        "normalized_text": "KOLs"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 10,
                        "username": "dabit3",
                        "id": "17189394"
                    }
                ]
            },
            "id": "1924178055838240853",
            "public_metrics": {
                "retweet_count": 14,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @dabit3: Another example of why building a great product is 100x more important than anything else. \n\nNo KOLs, no paid shills spamming g…"
        },
        {
            "created_at": "2025-05-18T18:58:37.000Z",
            "edit_history_tweet_ids": [
                "1924177826414047335"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 3,
                        "end": 10,
                        "probability": 0.5879,
                        "type": "Other",
                        "normalized_text": "GRIFFAIN"
                    },
                    {
                        "start": 42,
                        "end": 49,
                        "probability": 0.7081,
                        "type": "Other",
                        "normalized_text": "GRIFFAIN"
                    },
                    {
                        "start": 120,
                        "end": 123,
                        "probability": 0.5053,
                        "type": "Other",
                        "normalized_text": "MOBY"
                    },
                    {
                        "start": 256,
                        "end": 262,
                        "probability": 0.577,
                        "type": "Other",
                        "normalized_text": "ANTIRUG"
                    }
                ],
                "cashtags": [
                    {
                        "start": 119,
                        "end": 124,
                        "tag": "MOBY"
                    }
                ],
                "mentions": [
                    {
                        "start": 125,
                        "end": 135,
                        "username": "mobyagent",
                        "id": "1878834956891299841"
                    }
                ]
            },
            "id": "1924177826414047335",
            "public_metrics": {
                "retweet_count": 0,
                "reply_count": 11,
                "like_count": 6,
                "quote_count": 1,
                "bookmark_count": 1,
                "impression_count": 2241
            },
            "author_id": "1854960382097735681",
            "text": "A $GRIFFAIN whale just bought $31.55K of $GRIFFAIN at $106.04M MC 🐳\n\n30 Day Insights on this specific whale powered by $MOBY @mobyagent:\n🔹 Win Rate: 37.93%\n🔹 Total Trades: 29\n🔹 PnL: Positive\n🔹 Average Trade: $5.80K\n🔹 Total Volume: $168.24K\n🔹 Biggest Win: $ANTIRUG"
        },
        {
            "created_at": "2025-05-18T18:58:18.000Z",
            "edit_history_tweet_ids": [
                "1924177742670492039"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 2,
                        "end": 25,
                        "url": "https://t.co/GPX7lJg6gY",
                        "expanded_url": "https://twitter.com/patty_fi/status/1924177610935845240",
                        "display_url": "x.com/patty_fi/statu…"
                    }
                ]
            },
            "id": "1924177742670492039",
            "public_metrics": {
                "retweet_count": 5,
                "reply_count": 15,
                "like_count": 28,
                "quote_count": 3,
                "bookmark_count": 0,
                "impression_count": 3517
            },
            "author_id": "2760158505",
            "text": ". https://t.co/GPX7lJg6gY"
        },
        {
            "created_at": "2025-05-18T18:57:46.000Z",
            "edit_history_tweet_ids": [
                "1924177610935845240"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 21,
                        "end": 44,
                        "url": "https://t.co/WQGEjZ7s75",
                        "expanded_url": "https://x.com/patty_fi/status/1924177610935845240/photo/1",
                        "display_url": "pic.x.com/WQGEjZ7s75",
                        "media_key": "16_1924177605307113472"
                    }
                ]
            },
            "id": "1924177610935845240",
            "public_metrics": {
                "retweet_count": 11,
                "reply_count": 75,
                "like_count": 81,
                "quote_count": 5,
                "bookmark_count": 3,
                "impression_count": 8091
            },
            "author_id": "2760158505",
            "text": "Who’s still holding? https://t.co/WQGEjZ7s75",
            "attachments": {
                "media_keys": [
                    "16_1924177605307113472"
                ]
            }
        },
        {
            "created_at": "2025-05-18T18:57:29.000Z",
            "edit_history_tweet_ids": [
                "1924177538869498227"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 42,
                        "end": 65,
                        "url": "https://t.co/RUEbLO4GI3",
                        "expanded_url": "https://twitter.com/nakadai_mon/status/1924162636658200726",
                        "display_url": "x.com/nakadai_mon/st…"
                    }
                ],
                "annotations": [
                    {
                        "start": 28,
                        "end": 40,
                        "probability": 0.749,
                        "type": "Other",
                        "normalized_text": "microlamports"
                    }
                ]
            },
            "id": "1924177538869498227",
            "public_metrics": {
                "retweet_count": 3,
                "reply_count": 1,
                "like_count": 78,
                "quote_count": 7,
                "bookmark_count": 3,
                "impression_count": 18650
            },
            "author_id": "2327407569",
            "text": "Wait until they learn about microlamports https://t.co/RUEbLO4GI3"
        },
        {
            "created_at": "2025-05-18T18:55:32.000Z",
            "edit_history_tweet_ids": [
                "1924177048840409367"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 40,
                        "end": 48,
                        "probability": 0.6542,
                        "type": "Place",
                        "normalized_text": "Caribbean"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 15,
                        "username": "JLKHatesYou",
                        "id": "1664827724844740608"
                    }
                ]
            },
            "id": "1924177048840409367",
            "public_metrics": {
                "retweet_count": 4,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @JLKHatesYou: See now we’re talking\n\nCaribbean &gt; rest of the planet"
        },
        {
            "created_at": "2025-05-18T18:55:07.000Z",
            "edit_history_tweet_ids": [
                "1924176943718572520"
            ],
            "entities": {
                "mentions": [
                    {
                        "start": 3,
                        "end": 15,
                        "username": "cremedupepe",
                        "id": "2350263930"
                    }
                ]
            },
            "id": "1924176943718572520",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @cremedupepe: you asking the wrong group of people this question dude"
        },
        {
            "created_at": "2025-05-18T18:54:46.000Z",
            "edit_history_tweet_ids": [
                "1924176856296669272"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 0,
                        "end": 23,
                        "url": "https://t.co/Hjrb8ivKY4",
                        "expanded_url": "https://x.com/HopiumPapi/status/1924176856296669272/video/1",
                        "display_url": "pic.x.com/Hjrb8ivKY4",
                        "media_key": "13_1924176736230518784"
                    }
                ]
            },
            "id": "1924176856296669272",
            "public_metrics": {
                "retweet_count": 68,
                "reply_count": 132,
                "like_count": 160,
                "quote_count": 2,
                "bookmark_count": 1,
                "impression_count": 5980
            },
            "author_id": "1397323152053530626",
            "text": "https://t.co/Hjrb8ivKY4",
            "attachments": {
                "media_keys": [
                    "13_1924176736230518784"
                ]
            }
        },
        {
            "created_at": "2025-05-18T18:54:17.000Z",
            "edit_history_tweet_ids": [
                "1924176733218943344"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 61,
                        "end": 67,
                        "probability": 0.6156,
                        "type": "Organization",
                        "normalized_text": "arthurs"
                    },
                    {
                        "start": 69,
                        "end": 71,
                        "probability": 0.9412,
                        "type": "Organization",
                        "normalized_text": "BBC"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 13,
                        "username": "AlenaDaOG",
                        "id": "1869267834771275776"
                    },
                    {
                        "start": 15,
                        "end": 25,
                        "username": "blknoiz06",
                        "id": "973261472"
                    },
                    {
                        "start": 26,
                        "end": 39,
                        "username": "dreamtemple_",
                        "id": "1805546555245740032"
                    },
                    {
                        "start": 40,
                        "end": 52,
                        "username": "CryptoHayes",
                        "id": "983993370048630785"
                    }
                ]
            },
            "id": "1924176733218943344",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @AlenaDaOG: @blknoiz06 @dreamtemple_ @CryptoHayes id suck arthurs BBC for some merch too wtf this is sick"
        },
        {
            "created_at": "2025-05-18T18:54:07.000Z",
            "edit_history_tweet_ids": [
                "1924176693402513644"
            ],
            "id": "1924176693402513644",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 34,
                "like_count": 73,
                "quote_count": 2,
                "bookmark_count": 1,
                "impression_count": 4905
            },
            "author_id": "1262818098035462144",
            "text": "Yea I never been with a women but why would I spend my time with something so soft and full of estrogen? I prefer to surround myself with high testosterone things like hairy men"
        },
        {
            "created_at": "2025-05-18T18:53:36.000Z",
            "edit_history_tweet_ids": [
                "1924176560321356172"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 77,
                        "end": 84,
                        "probability": 0.8924,
                        "type": "Place",
                        "normalized_text": "U.S soil"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 7,
                        "username": "e38",
                        "id": "26038623"
                    }
                ]
            },
            "id": "1924176560321356172",
            "public_metrics": {
                "retweet_count": 2,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @e38: Them Asians got it even that stank country (when they’re cooking on U.S soil). I learned Asians can make their food transform base…"
        },
        {
            "created_at": "2025-05-18T18:53:10.000Z",
            "edit_history_tweet_ids": [
                "1924176454801043475"
            ],
            "entities": {
                "mentions": [
                    {
                        "start": 3,
                        "end": 17,
                        "username": "DonCryptonium",
                        "id": "1314846469128585216"
                    }
                ]
            },
            "id": "1924176454801043475",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "973261472",
            "text": "RT @DonCryptonium: None of those group. White people make the best food ever. The quality, the flavours, olive oil, fresh tomatoes touched…"
        },
        {
            "created_at": "2025-05-18T18:52:18.000Z",
            "edit_history_tweet_ids": [
                "1924176234310684695"
            ],
            "entities": {
                "annotations": [
                    {
                        "start": 3,
                        "end": 6,
                        "probability": 0.4921,
                        "type": "Other",
                        "normalized_text": "FWOG"
                    },
                    {
                        "start": 38,
                        "end": 41,
                        "probability": 0.3327,
                        "type": "Other",
                        "normalized_text": "Bert"
                    },
                    {
                        "start": 111,
                        "end": 114,
                        "probability": 0.4656,
                        "type": "Other",
                        "normalized_text": "MOBY"
                    },
                    {
                        "start": 245,
                        "end": 250,
                        "probability": 0.4142,
                        "type": "Organization",
                        "normalized_text": "POPCAT"
                    }
                ],
                "cashtags": [
                    {
                        "start": 2,
                        "end": 7,
                        "tag": "FWOG"
                    },
                    {
                        "start": 37,
                        "end": 42,
                        "tag": "Bert"
                    },
                    {
                        "start": 110,
                        "end": 115,
                        "tag": "MOBY"
                    },
                    {
                        "start": 244,
                        "end": 251,
                        "tag": "POPCAT"
                    }
                ],
                "mentions": [
                    {
                        "start": 116,
                        "end": 126,
                        "username": "mobyagent",
                        "id": "1878834956891299841"
                    }
                ]
            },
            "id": "1924176234310684695",
            "public_metrics": {
                "retweet_count": 1,
                "reply_count": 11,
                "like_count": 7,
                "quote_count": 0,
                "bookmark_count": 1,
                "impression_count": 2260
            },
            "author_id": "1854960382097735681",
            "text": "A $FWOG whale just bought $23.90K of $Bert at $32.96M MC 🐳\n\n30 Day Insights on this specific whale powered by $MOBY @mobyagent:\n🔹 Win Rate: 7.75%\n🔹 Total Trades: 129\n🔹 PnL: Positive\n🔹 Average Trade: $9.44K\n🔹 Total Volume: $1.22M\n🔹 Biggest Win: $POPCAT"
        },
        {
            "created_at": "2025-05-18T18:49:46.000Z",
            "edit_history_tweet_ids": [
                "1924175595383963944"
            ],
            "entities": {
                "urls": [
                    {
                        "start": 107,
                        "end": 130,
                        "url": "https://t.co/Tht2RVWwtw",
                        "expanded_url": "https://x.com/elonmusk/status/1433713164546293767",
                        "display_url": "x.com/elonmusk/statu…"
                    }
                ],
                "cashtags": [
                    {
                        "start": 25,
                        "end": 30,
                        "tag": "Time"
                    }
                ],
                "mentions": [
                    {
                        "start": 3,
                        "end": 13,
                        "username": "IzCryptoG",
                        "id": "1777976718579646464"
                    },
                    {
                        "start": 15,
                        "end": 24,
                        "username": "Dior100x",
                        "id": "2728708501"
                    }
                ]
            },
            "id": "1924175595383963944",
            "public_metrics": {
                "retweet_count": 8,
                "reply_count": 0,
                "like_count": 0,
                "quote_count": 0,
                "bookmark_count": 0,
                "impression_count": 0
            },
            "author_id": "950525897618096128",
            "text": "RT @IzCryptoG: @Dior100x $Time\n\nThe ULTIMATE Currency \n\nCA - DpySBBrUSyRoSSovFjaoxb9MityQJ9ZYbK9yPWxapump\n\nhttps://t.co/Tht2RVWwtw https://…"
        }
    ],
    "includes": {
        "media": [
            {
                "media_key": "13_1924180387703533568",
                "preview_image_url": "https://pbs.twimg.com/amplify_video_thumb/1924180387703533568/img/I_6L92EftYOhHbdm.jpg",
                "type": "video"
            },
            {
                "media_key": "3_1924188790182055936",
                "type": "photo",
                "url": "https://pbs.twimg.com/media/GrQXgoeXEAAG5Pu.jpg"
            },
            {
                "media_key": "3_1924184257766776832",
                "type": "photo",
                "url": "https://pbs.twimg.com/media/GrQTYz6WYAAJ8YG.png"
            },
            {
                "media_key": "3_1924183305940791296",
                "type": "photo",
                "url": "https://pbs.twimg.com/media/GrQShaFWcAAj107.jpg"
            },
            {
                "media_key": "13_1924167808281190400",
                "preview_image_url": "https://pbs.twimg.com/amplify_video_thumb/1924167808281190400/img/9Sl380WDMmAdx-cH.jpg",
                "type": "video"
            },
            {
                "media_key": "3_1924169800734904320",
                "type": "photo",
                "url": "https://pbs.twimg.com/media/GrQGPTRWkAAcbeO.jpg"
            },
            {
                "media_key": "3_1924178208611807233",
                "type": "photo",
                "url": "https://pbs.twimg.com/media/GrQN4tDasAEzmgp.jpg"
            },
            {
                "media_key": "16_1924177605307113472",
                "preview_image_url": "https://pbs.twimg.com/tweet_video_thumb/GrQNVlkXoAA9x4L.jpg",
                "type": "animated_gif"
            },
            {
                "media_key": "13_1924176736230518784",
                "preview_image_url": "https://pbs.twimg.com/amplify_video_thumb/1924176736230518784/img/n2cDrsiaN-AEl-Rh.jpg",
                "type": "video"
            }
        ]
    },
    "meta": {
        "result_count": 49,
        "next_token": "7140dibdnow9c7btw4e0hnbx9hoqp9vftrn4czbkhh838"
    }
}
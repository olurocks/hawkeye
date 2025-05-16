import * as path from 'path';
import * as fs from 'fs';
import mongoose from 'mongoose';

const MediaSchema = new mongoose.Schema(
  {
    media_key: { type: String, required: true },
    type: { type: String, required: true },
    urls: [{ type: String }], // This should be an array of strings
    preview_image_url: { type: String },
    alt_text: { type: String },
  }
  // { _id: false } // Disable automatic creation of _id field for subdocuments
);

const TweetSchema = new mongoose.Schema(
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

const db_username = "psyxhval";
const db_password = "DH35QpshmF1YPykt";

function normalizeMongoExtendedJson(doc: any): any {
    if (Array.isArray(doc)) {
      return doc.map(normalizeMongoExtendedJson);
    } else if (typeof doc === 'object' && doc !== null) {
      if ('$date' in doc) {
        return new Date(Number(doc['$date']['$numberLong']));
      }
      if ('$oid' in doc) {
        return doc['$oid'];
      }
      if ('$numberInt' in doc) {
        return Number(doc['$numberInt']);
      }
      if ('$numberLong' in doc) {
        return Number(doc['$numberLong']);
      }
  
      const normalized: any = {};
      for (const key in doc) {
        normalized[key] = normalizeMongoExtendedJson(doc[key]);
      }
      return normalized;
    } else {
      return doc;
    }
  }
  

export const connectDb = async () => {
  try {
    await mongoose.connect(
      `mongodb+srv://${db_username}:${db_password}@cluster0.vzqjc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
    );
    console.log("MongoDB connection successful");
  } catch (error: any) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1); // Exit the process if DB connection fails
  }
};

// Load tweets
const tweetsPath = path.join(__dirname, 'tweets', 'tweets.json');
const rawTweets = JSON.parse(fs.readFileSync(tweetsPath, 'utf-8'));
let tweets = normalizeMongoExtendedJson(rawTweets);console.log("Tweets loaded successfully:", tweets.length, "tweets found.");

tweets = tweets.map((tweet: any) => {
    const { _id, ...rest } = tweet;
    return rest;
  });

  const seedTweets = async (tweets: any[]) => {
    await connectDb();
  
    try {
      for (const tweet of tweets) {
        const exists = await Tweet.findOne({ tweet_id: tweet.tweet_id });
        if (exists) {
          console.log(`Skipping duplicate tweet: ${tweet.tweet_id}`);
          continue;
        }
  
        const result = await Tweet.create(tweet);
        console.log("Tweet inserted successfully:", result._id);
      }
  
      console.log("All tweets seeded successfully");
    } catch (error: any) {
      console.error("Error seeding tweets:", error.message);
    } finally {
      mongoose.connection.close();
    }
  };
  

seedTweets(tweets);

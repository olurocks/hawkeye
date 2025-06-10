import { Tweet } from "./src/models/tweet.model";// Adjust path as needed
import { Author } from "./src/models/author.model";// Adjust path as needed
import { updateCashtagTracking } from "./src/utils/helpers";
import { extractCashtags } from "./src/utils/helpers";
import { connectDb } from "./src/config/database";


connectDb()
/**
 * Migration script to extract cashtags from existing tweets and populate the cashtags table
 */
export const migrateCashtagsFromExistingTweets = async () => {
  console.log("Starting cashtag migration from existing tweets...");
  
  let processedCount = 0;
  let tweetsWithCashtags = 0;
  let totalCashtagsFound = 0;
  const batchSize = 100; // Process tweets in batches to avoid memory issues
  let skip = 0;
  
  try {
    // Get total count of tweets for progress tracking
    const totalTweets = await Tweet.countDocuments();
    console.log(`Total tweets to process: ${totalTweets}`);
    
    while (skip < totalTweets) {
      console.log(`Processing batch: ${skip + 1} to ${Math.min(skip + batchSize, totalTweets)}`);
      
      // Get batch of tweets with author info
      const tweets = await Tweet.find({})
        .skip(skip)
        .limit(batchSize)
        .sort({ created_at: 1 }); // Process oldest first
      
      if (tweets.length === 0) {
        break;
      }
      
      // Process each tweet in the batch
      for (const tweet of tweets) {
        try {
          // Extract cashtags from tweet text
          const cashtags = extractCashtags(tweet.text);
          
          if (cashtags.length > 0) {
            tweetsWithCashtags++;
            totalCashtagsFound += cashtags.length;
            
            console.log(`Tweet ${tweet.tweet_id} contains cashtags:`, cashtags.join(", "));
            
            // Get author info (should already be available in the tweet document)
            let authorId = tweet.author_id;
            let username = tweet.username;
            
            // If username is not available in tweet, fetch from Author model
            if (!username) {
              const author = await Author.findOne({ author_id: authorId });
              username = author?.username || `user_${authorId}`;
            }
            
            // Update cashtag tracking using existing function
            await updateCashtagTracking(
              cashtags,
              authorId,
              username,
              tweet.tweet_id,
              new Date(tweet.created_at)
            );
            
            // Also update the tweet document to include cashtags string if not already present
            if (!tweet.cashtags || tweet.cashtags === "") {
              await Tweet.updateOne(
                { _id: tweet._id },
                { $set: { cashtags: cashtags.join(", ") } }
              );
            }
          }
          
          processedCount++;
          
          // Progress update every 50 tweets
          if (processedCount % 50 === 0) {
            console.log(`Progress: ${processedCount}/${totalTweets} tweets processed`);
          }
          
        } catch (tweetError) {
          console.error(`Error processing tweet ${tweet.tweet_id}:`, tweetError);
          // Continue with next tweet instead of stopping
        }
      }
      
      skip += batchSize;
      
      // Small delay between batches to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log("\n=== Migration Complete ===");
    console.log(`Total tweets processed: ${processedCount}`);
    console.log(`Tweets with cashtags: ${tweetsWithCashtags}`);
    console.log(`Total cashtags found: ${totalCashtagsFound}`);
    console.log(`Average cashtags per tweet: ${tweetsWithCashtags > 0 ? (totalCashtagsFound / tweetsWithCashtags).toFixed(2) : 0}`);
    
    return {
      processedCount,
      tweetsWithCashtags,
      totalCashtagsFound
    };
    
  } catch (error) {
    console.error("Error during cashtag migration:", error);
    throw error;
  }
};

/**
 * Alternative function to run migration with additional error handling and resume capability
 */
export const migrateCashtagsWithResume = async (startFromTweetId?: string) => {
  console.log("Starting cashtag migration with resume capability...");
  
  let processedCount = 0;
  let tweetsWithCashtags = 0;
  let totalCashtagsFound = 0;
  const batchSize = 50; // Smaller batch size for better error recovery
  
  try {
    // Build query - if resuming, start from specific tweet
    let query: any = {};
    if (startFromTweetId) {
      const resumeTweet = await Tweet.findOne({ tweet_id: startFromTweetId });
      if (resumeTweet) {
        query.created_at = { $gte: resumeTweet.created_at };
        console.log(`Resuming from tweet ${startFromTweetId} at ${resumeTweet.created_at}`);
      }
    }
    
    const totalTweets = await Tweet.countDocuments(query);
    console.log(`Total tweets to process: ${totalTweets}`);
    
    // Use cursor for memory efficiency with large datasets
    const cursor = Tweet.find(query).sort({ created_at: 1 }).cursor({ batchSize });
    
    for (let tweet = await cursor.next(); tweet != null; tweet = await cursor.next()) {
      try {
        const cashtags = extractCashtags(tweet.text);
        
        if (cashtags.length > 0) {
          tweetsWithCashtags++;
          totalCashtagsFound += cashtags.length;
          
          let authorId = tweet.author_id;
          let username = tweet.username;
          
          if (!username) {
            const author = await Author.findOne({ author_id: authorId });
            username = author?.username || `user_${authorId}`;
          }
          
          await updateCashtagTracking(
            cashtags,
            authorId,
            username,
            tweet.tweet_id,
            new Date(tweet.created_at)
          );
          
          // Update tweet document with cashtags
          if (!tweet.cashtags || tweet.cashtags === "") {
            await Tweet.updateOne(
              { _id: tweet._id },
              { $set: { cashtags: cashtags.join(", ") } }
            );
          }
          
          console.log(`✓ Processed tweet ${tweet.tweet_id} - cashtags: ${cashtags.join(", ")}`);
        }
        
        processedCount++;
        
        if (processedCount % 100 === 0) {
          console.log(`Progress: ${processedCount} tweets processed, ${tweetsWithCashtags} with cashtags`);
          console.log(`Latest processed tweet ID: ${tweet.tweet_id} (${tweet.created_at})`);
        }
        
      } catch (tweetError) {
        console.error(`Error processing tweet ${tweet.tweet_id}:`, tweetError);
        console.log(`Resume from this tweet ID if needed: ${tweet.tweet_id}`);
        // Continue processing instead of stopping
      }
    }
    
    console.log("\n=== Migration Complete ===");
    console.log(`Total tweets processed: ${processedCount}`);
    console.log(`Tweets with cashtags: ${tweetsWithCashtags}`);
    console.log(`Total cashtags found: ${totalCashtagsFound}`);
    
    return {
      processedCount,
      tweetsWithCashtags,
      totalCashtagsFound
    };
    
  } catch (error) {
    console.error("Error during cashtag migration:", error);
    throw error;
  }
};

/**
 * Function to run the migration - choose your preferred method
 */
export const runCashtagMigration = async () => {
  try {
    // Choose one of these methods:
    
    // Method 1: Simple batch processing
    // const result = await migrateCashtagsFromExistingTweets();
    
    // Method 2: More robust with resume capability (recommended for large datasets)
    const result = await migrateCashtagsWithResume();
    
    console.log("Migration completed successfully:", result);
    return result;
    
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
};

// Export for direct execution
if (require.main === module) {
  runCashtagMigration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Migration script failed:", error);
      process.exit(1);
    });
}


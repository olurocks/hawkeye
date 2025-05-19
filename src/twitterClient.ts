// twitterClient.ts - Modified to accept socket.io instance
import {processTweet, getTweetsFromList} from "./utils/helpers"
import { Server } from "socket.io";


const listId = "1923446693082612078";

export const pollTweets = async (io: Server) => {
  try {
    const { tweets, includes } = await getTweetsFromList(listId);
    
    if (tweets && tweets.length > 0) {
      console.log(`Processing ${tweets.length} tweets`);
      const newTweets= []
      
      for (const tweet of tweets) {
        await processTweet(tweet, io, includes.media);
        newTweets.push(tweet);
      }
      
      io.emit("new-tweets", newTweets);
      console.log("Emitted new tweets to connected clients");
      console.log("Instructed frontend clients to get the latest updates from the database");
    } else {
      console.log("No tweets found in the list or API returned empty response");
    }
  } catch (error) {
    console.error("Error polling tweets:", error);
  }
};



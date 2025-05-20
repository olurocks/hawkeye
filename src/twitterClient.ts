// twitterClient.ts - Modified to accept socket.io instance
import {processTweet, getTweetsFromList} from "./utils/helpers"
import { Server } from "socket.io";


const listId = "1923446693082612078";

export const pollTweets = async (io: Server) => {
  try {
    const { tweets, includes } = await getTweetsFromList(listId);
    
    if (tweets && tweets.length > 0) {
      const newTweets = [];

      for (const tweet of tweets) {
        const savedTweet = await processTweet(tweet, io, includes?.media);
        if (!savedTweet) {
          continue;
        }
        newTweets.push(savedTweet);
      }

      io.emit("new-tweets", newTweets);
    } else {
      console.log("No tweets found in the list or API returned empty response");
    }
  } catch (error) {
    console.error("Error polling tweets:", error);
  }
};



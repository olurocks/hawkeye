import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import axios from "axios";
import { Tweet } from "../models/tweet.model";
import path from "path";

import { BASE_URL, BEARER_TOKEN, PORT } from "../utils/constants";

const app = express();

// Serve static files from React build folder in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/build')));
  
  // Handle any requests that don't match the API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/build', 'index.html'));
  });
} else {
  // In development, use the existing static files setup
  app.use(express.static(path.join(__dirname, "../public")));
}


const server = app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
const wss = new WebSocketServer({ server });

const twitterClient = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
});

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("New client connected");
  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

export const startTwitterStream = async (accounts: string[]) => {
  try {
    // Delete existing stream rules
    const rulesResponse = await twitterClient.get(
      "/tweets/search/stream/rules"
    );
    const existingRules = rulesResponse.data.data || [];
    if (existingRules.length > 0) {
      const ruleIds = existingRules.map((rule: any) => rule.id);
      await twitterClient.post("/tweets/search/stream/rules", {
        delete: { ids: ruleIds },
      });
    }

    // Add rules to monitor specific accounts
    const rules = accounts.map((account) => ({ value: `from:${account}` }));
    await twitterClient.post("/tweets/search/stream/rules", { add: rules });

    // Open the stream
    const stream = await twitterClient.get("/tweets/search/stream", {
      params: {
        "tweet.fields": "created_at,attachments,entities,public_metrics",
        "media.fields": "url,preview_image_url,type",
        expansions: "attachments.media_keys",
        "user.fields": "profile_image_url, username, name",
      },
      responseType: "stream",
    });

    console.log("Monitoring tweets in real-time...");
    stream.data.on("data", async (chunk: Buffer) => {
      try {
        const data = chunk.toString();
        if (data.trim()) {
          const tweetData = JSON.parse(data);

          if (tweetData.data) {
            const tweet = tweetData.data;
            const media = tweetData.includes?.media || [];
            const users = tweetData.includes?.users || [];

            const user = users.find(
              (u: { id: string }) => u.id === tweet.author_id
            ); //check for errors when testing
            const username = user ? user.username : "Unknown";

            const newTweet = new Tweet({
              tweet_id: tweet.id,
              text: tweet.text,
              author_id: tweet.author_id,
              username: username,
              created_at: tweet.created_at,
              media: media,
              entities: tweet.entities,
            });

            try {
              await newTweet.save();
            } catch (error) {
              console.error("error saving tweet to the database", error);
            }

            //broadcast the tweet to all open websockets
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ tweet, media, users }));
              }
            });
          }
        }
      } catch (parseError) {
        console.error("Error parsing tweet data:", parseError);
      }
    });

    stream.data.on("error", (error: any) => {
      console.error("Stream error:", error);
      // Reconnect the stream on error
      setTimeout(() => startTwitterStream(accounts), 5000);
    });
  } catch (error: any) {
    console.error(
      "Error setting up stream:",
      error.response?.data || error.message
    );
    wss.clients.forEach((client) => {
      if(client.readyState === WebSocket.OPEN){
        client.send(JSON.stringify({
          type: "error",
          message: "Error setting up stream",
          details: error.response?.data || error.message
        }))
      }
    })
    // Retry on failure
    setTimeout(() => startTwitterStream(accounts), 50000);
  }
};

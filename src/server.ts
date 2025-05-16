import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import { ACCOUNTS_TO_MONITOR, PORT } from "./utils/constants";
import { startMultiAccountScraping } from "./scraper/scraper";
import logger from "./logging/logger";
import twitter from "./scraper/config/puppeteer";
import { connectDb } from "./config/database";
const cors = require("cors");

connectDb();

const app = express();

// Apply CORS middleware to Express app - THIS IS THE IMPORTANT FIX
app.use(cors({
  origin: "http://localhost:3001", // Your frontend URL
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

const httpServer = createServer(app);
export const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3001", // Your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

app.get("/", (req, res) => {
  res.send("Twitter Scraper Server Running");
});

import { Tweet } from "./models/tweet.model"; // Import your Tweet model
import { ITweet } from "./utils/interfaces";

// API route to get tweets
app.get("/api/tweets", async (req, res) => {
  try {
    // Get latest 200 tweets, sorted by date
    const tweets = await Tweet.find().sort({ createdAt: -1 }).limit(200);
    
    // Add debugging
    console.log(`Sending ${tweets.length} tweets to client`);
    
    res.json(tweets);
  } catch (error) {
    logger.error("Error fetching tweets:", error);
    res.status(500).json({ error: "Failed to fetch tweets" });
  }
});

// Modify your tweet emission logic to include this
// When you detect a new tweet in your scraper:
export const emitNewTweet = (tweet: ITweet) => {
  io.emit("new_tweet", tweet);
};

httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    await twitter.initialize("_d_aslan");
    const result = await twitter.login("_d_aslan", "t3rm1nat0r");

    if (result) {
      const { page } = result;
      const scraper = await startMultiAccountScraping(page.browser(), [
        "olur0cks",
        "blknoiz06",
        "Dior100x"
      ]);

      process.on("SIGINT", async () => {
        logger.info("Shutting down server and stopping scraper...");
        scraper.stopAllMonitoring();
        await page.close();
        process.exit(0);
      });
    } else {
      logger.error("❌ Login failed.");
      process.exit(1);
    }
  } catch (error) {
    logger.error("❌ An error occurred during scraping:", error);
    process.exit(1);
  }
});
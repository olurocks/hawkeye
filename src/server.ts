import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import { PORT } from "./utils/constants";
import { connectDb } from "./config/database";
import { Tweet } from "./models/tweet.model";
import { ITweet } from "./utils/interfaces";
import { pollTweets } from "./twitterClient";

import cors from "cors";
import { CashtagUtils } from "./helpers/cashtagHelpers";
import { error } from "console";

const productionUrl = process.env.PRODUCTION_FRONTEND_URL;
const developmentUrl = process.env.DEVELOPMENT_FRONTEND_URL;
const mode = process.env.MODE || "development";

export async function startServer() {
  // Connect to database
  await connectDb();

  const app = express();
  const allowedOrigin = mode === "production" ? productionUrl : developmentUrl;

  let io: Server;
  const httpServer = createServer(app);

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin, // Your frontend URL
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    },
  });
  app.use(
    cors({
      origin: allowedOrigin, // Your frontend URL
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  //delete in prod
  io.on("connection", (socket) => {
    console.log("New client connected");

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  app.get("/", (req, res) => {
    res.send("Twitter Scraper Server Running");
  });

  // API route to get tweets
  app.get("/api/tweets", async (req, res) => {
    try {
      // Get latest 200 tweets, sorted by date
      const tweets = await Tweet.find().sort({ createdAt: -1 }).limit(200);

      // Add debugging
      console.log(`Sending ${tweets.length} tweets to client`);

      res.json(tweets);
    } catch (error) {
      console.error("Error fetching tweets:", error);
      res.status(500).json({ error: "Failed to fetch tweets" });
    }
  });

  app.get("/api/cashtags/trending", async (req, res) => {
    try {
      const trending = await CashtagUtils.getTrendingCashtags(20);
      res.json(trending);
    } catch (error) {
      console.error("Error fetching trending cashtags:", error);
      res.status(500).json({ error: "Failed to fetch trending cashtags" });
    }
  });

  //get token stats
  app.get("/api/ticker/stats", async (req, res) => {
    const ticker = req.query.ticker as string;
    if (!ticker) {
      res.status(400).json({ error: "Ticker query parameter is required" });
      return;
    }

    const tickerStats = await CashtagUtils.getCashtagDetail(ticker);
    if (!tickerStats) {
      res.status(404).json({ error: "Ticker not found" });
      return;
    }
    res.json(tickerStats);
  });

  app.get("/api/author/cashtags", async (req, res) => {
    const authorId = req.query.authorId as string;
    if (!authorId) {
      res.status(400).json({ error: "Author ID query parameter is required" });
      return;
    }

    try {
      const cashtags = await CashtagUtils.getCashtagsByAuthor(authorId);
      res.json(cashtags);
    } catch (error) {
      console.error("Error fetching cashtags by author:", error);
      res.status(500).json({ error: "Failed to fetch cashtags by author" });
    }
  });

  // Start listening on specified port
  await new Promise<void>((resolve) => {
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      resolve();
    });
  });

  // Return the io and server instances for use by the Twitter client
  return { io, server: httpServer };
}

// Helper function for emitting tweets (for reference)

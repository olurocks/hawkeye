// server.ts - Modified to export both server and io
import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import { PORT } from "./utils/constants";
import { connectDb } from "./config/database";
import { Tweet } from "./models/tweet.model";
import { ITweet } from "./utils/interfaces";
import { pollTweets } from "./twitterClient";

import cors from "cors";

export async function startServer() {
  // Connect to database
  await connectDb();

  const app = express();

  // Apply CORS middleware to Express app
  app.use(
    cors({
      origin: "http://localhost:3001", // Your frontend URL
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
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

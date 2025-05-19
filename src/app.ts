// index.ts - Main application entry point
import { startServer } from "./server";
import { pollTweets } from "./twitterClient";
// This file connects your Twitter client and server together

async function main() {
  try {
    const { io, server } = await startServer();

    // Initial poll
    await pollTweets(io);

    // Set up continuous polling every 65 seconds
    const pollInterval = setInterval(async () => {
      try {
        await pollTweets(io);
      } catch (error) {
        console.error("Error during scheduled polling:", error);
      }
    }, 65000);

    // Handle cleanup on exit
    process.on("SIGINT", () => {
      // clearInterval(pollInterval);
      console.log("Shutting down application...");
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    });

    console.log(
      "Twitter stream and server successfully connected and running!"
    );
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

// Handle process termination
process.on("SIGINT", () => {
  console.log("Shutting down application...");
  process.exit(0);
});

// Start the application
main();

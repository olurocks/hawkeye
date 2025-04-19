import axios from "axios";

import { Media } from "../models/media.model";
// import { Tweet } from "../models/tweet.model";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { Worker } from "worker_threads";

import { promisify } from "util";
import logger from "../logging/logger";

const MEDIA_DIR = path.join(__dirname, "../../data/media");
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
export const unlinkAsync = promisify(fs.unlink);

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

export function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-version"]);
    ffmpeg.on("error", () => {
      logger.error("❌ FFmpeg not found in PATH. Please install FFmpeg.");
      resolve(false);
    });
    ffmpeg.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

// Fetch video as Base64 //this needs to be worked on before saving the video as base64
export async function convertM3u8ToBase64(
  url: string,
  outputBase64File: string = "outputBase64File.txt"
): Promise<{ base64Data: string; tempFile: string }> {
  // Create a temporary file for the video
  const tempFile = `temp_${Date.now()}.mp4`;
  console.log(`Processing ${url}...`);

  try {
    // Download the video to a temporary file
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i",
        url,
        "-c",
        "copy", // Copy without re-encoding
        "-bsf:a",
        "aac_adtstoasc", // Fix for some audio streams
        tempFile,
      ]);

      // Log progress
      let progressLine = "";
      ffmpeg.stderr.on("data", (data) => {
        const output = data.toString();
        if (output.includes("frame=") || output.includes("speed=")) {
          progressLine = output.split("\n")[0].trim();
          process.stdout.write(`\r${progressLine}`);
        } else if (!output.includes("Press [q] to stop")) {
          // Filter out common noisy messages
          logger.error(output);
        }
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          console.log(`\nVideo downloaded to temporary file.`);
          resolve();
        } else {
          logger.error(`\nError downloading video. Exit code: ${code}`);
          reject(new Error("FFMPEG process failed"));
        }
      });

      ffmpeg.on("error", (err) => {
        logger.error(`Error spawning ffmpeg process: ${err.message}`);
        reject(err);
      });
    });

    // Read the file and convert to base64
    console.log(
      "Converting to base64... (this may take some time for large videos)"
    );
    const videoBuffer = await readFileAsync(tempFile);
    const base64Data = videoBuffer.toString("base64");

    // Save base64 to output file
    await writeFileAsync(outputBase64File, base64Data);
    console.log(`Base64 data saved to ${outputBase64File}`);

    // Show file size information
    const originalSize = videoBuffer.length;
    const base64Size = base64Data.length;
    console.log(
      `Original video size: ${(originalSize / (1024 * 1024)).toFixed(2)} MB`
    );
    console.log(`Base64 size: ${(base64Size / (1024 * 1024)).toFixed(2)} MB`);

    return { base64Data, tempFile };
  } catch (error) {
    // Make sure to clean up temp file if it exists
    // if (fs.existsSync(tempFile)) {
    //   await unlinkAsync(tempFile);
    // }
    throw error;
  }
}

export function convertM3u8ToBase64Worker(
  url: string,
  outputBase64File: string = "outputBase64File.txt"
): Promise<{ base64Data: string; tempFile: string }> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "worker", "mediaWorker.mjs");

    const worker = new Worker(workerPath, {
      workerData: { url, outputBase64File },
    });

    worker.on("message", (data) => {
      if (data.error) {
        reject(new Error(data.error));
      } else {
        resolve(data);
      }
      worker.terminate();
    });

    worker.on("error", reject);
  });
}

export const saveMedia = async (
  tweetId: string,
  mediaUrls: string[],
  hasVideo: boolean = false
) => {
  if (!mediaUrls || mediaUrls.length === 0) {
    console.log("No media found for tweet:", tweetId);
    return;
  }

  const processedUrls = new Set(); // Avoid processing duplicate URLs

  for (const mediaUrl of mediaUrls) {
    try {
      // Skip if already processed
      if (processedUrls.has(mediaUrl)) continue;
      processedUrls.add(mediaUrl);

      // const fileExtension = mediaUrl.split(".").pop()?.toLowerCase() || "";

      const urlParts = mediaUrl.split("?")[0]; // Remove query parameters
      const fileExtension = urlParts.split(".").pop()?.toLowerCase() || "";
      const mediaType =
        new URL(mediaUrl).searchParams.get("format")?.toLowerCase() || "";

      // Handle images
      if (["jpg", "jpeg", "png", "gif"].includes(mediaType)) {
        const response = await axios.get(mediaUrl, {
          responseType: "arraybuffer",
          timeout: 10000, // 10 second timeout
        });

        const mediaBase64 = Buffer.from(response.data).toString("base64");

        await Media.create({
          tweet_id: tweetId,
          media_base_64: mediaBase64,
          media_type: fileExtension,
        });

        console.log(`✅ Saved image for tweet ${tweetId}`);
      }
      // Handle videos
      else if (["m3u8"].includes(fileExtension) && hasVideo) {
        // Check for FFmpeg
        const ffmpegAvailable = await checkFfmpeg();
        if (!ffmpegAvailable) {
          logger.error("❌ Skipping video download. FFmpeg not found.");
          continue;
        }

        // Convert M3U8 to Base64
        const { base64Data, tempFile } = await convertM3u8ToBase64Worker(
          mediaUrl
        );

        // Save to database
        await Media.create({
          tweet_id: tweetId,
          media_base_64: base64Data,
          media_type: "mp4",
        });

        // Clean up temp file
        await unlinkAsync(tempFile);

        console.log(`✅ Saved video for tweet ${tweetId}`);
      }
    } catch (error) {
      console.error(`❌ Error saving media for tweet ${tweetId}:`, error);
    }
  }
};

//home/psyxh/projects/stream-watch/src/services/worker/mediaWorker.mjs

export const saveMediaWorker = (
  tweetId: string,
  mediaUrls: string[],
  hasVideo = false
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./src/services/worker/mediaWorker.mjs", {
      workerData: { tweetId, mediaUrls, hasVideo },
    });

    worker.on("message", (msg) => console.log(msg.message));

    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code === 0) {
        resolve(
          `✅ Media processing for tweet ${tweetId} completed successfully.`
        );
      } else {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
};

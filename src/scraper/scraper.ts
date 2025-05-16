import { Page, Browser } from "puppeteer";
import { Tweet } from "../models/tweet.model";
import { response } from "express";
import { saveMedia, saveMediaWorker } from "./mediaHandler";
import logger from "../logging/logger";
import { frequency } from "../utils/constants";
import { ITweet, IMedia, STweet } from "../utils/interfaces";
import { io } from "../server";
//friendly reminder if it works don't touch it

export class TwitterScraper {
  private page: Page;
  private lastKnownTweetIds: Map<string, string> = new Map();
  private videoUrls: Set<string> = new Set();
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private profileImageCache: Map<string, string> = new Map(); // Cache for profile images

  constructor(page: Page) {
    this.page = page;
  }

  //function to wait for an event like a video to load before continuing
  async waitForCondition(
    conditionFn: () => Promise<boolean>,
    timeout: number,
    interval: number
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await conditionFn()) return;
      await new Promise((res) => setTimeout(res, interval));
    }
  }

  //function to setup video interception
  private setupVideoInterception(): void {
    // Clear previous listeners to avoid duplicates
    this.page.removeAllListeners("response");
    this.videoUrls.clear();

    this.page.on("response", async (response) => {
      const url = response.url();
      if (url.includes(".m3u8")) {
        // console.log(`📹 Captured m3u8 URL: ${url}`);
        this.videoUrls.add(url);
      }

      // Capture both m3u8 and mp4 URLs for better coverage to be used in case mp4 is needed
      //  if (url.includes(".m3u8") || url.includes(".mp4")) {
      //   console.log(`📹 Captured media URL: ${url}`);
      //   this.videoUrls.add(url);
      // }
    });
  }

  private async getVideoUrlFromTweetId(
    tweetId: string
  ): Promise<string | null> {
    try {
      this.setupVideoInterception();

      await this.page.goto(`https://twitter.com/i/web/status/${tweetId}`, {
        waitUntil: "networkidle2",
      });

      await this.page.evaluate(() => {
        const videoPlayer = document.querySelector(
          'div[data-testid="videoPlayer"]'
        );
        if (videoPlayer) {
          (videoPlayer as HTMLElement).click();
        }
      });

      await this.waitForCondition(
        async () => {
          const videoExists = await this.page.evaluate(
            () => document.querySelector("video") !== null
          );
          return videoExists;
        },
        30000,
        500
      );

      await new Promise((resolve) => setTimeout(resolve, 3000));

      if (this.videoUrls.size > 0) {
        return Array.from(this.videoUrls)[0];
      }

      return null;
    } catch (error) {
      console.error("Error getting video URL from tweet ID:", error);
      return null;
    }
  }

  private async getImageUrlsFromTweetId(tweetId: string): Promise<string[]> {
    try {
      console.log(`Extracting images from tweet ID: ${tweetId}`);

      // Get the browser instance from the current page
      const browser = this.page.browser();

      // Create a new page/tab
      const imagePage = await browser.newPage();

      // Set fullscreen viewport
      const screen = await imagePage.evaluate(() => {
        return {
          width: window.screen.availWidth,
          height: window.screen.availHeight,
        };
      });

      await imagePage.setViewport({
        width: screen.width,
        height: screen.height,
      });

      // Navigate to the tweet
      await imagePage.goto(`https://twitter.com/i/web/status/${tweetId}`, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Wait a moment to let the DOM settle
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Set to fullscreen mode
      await imagePage.evaluate(() => {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        }
      });

      // Wait for tweet content to be in the DOM
      await imagePage.waitForSelector('article[data-testid="tweet"]', {
        timeout: 15000,
      });

      // Wait longer after interactions
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Scroll to ensure images are loaded
      await imagePage.evaluate(() => {
        window.scrollTo(0, 300);
      });

      // Optional: wait again to ensure images begin to load
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("Scrolled page to help load images");

      // Scrape image URLs
      const imageUrls = await imagePage.evaluate(() => {
        const tweet = document.querySelector('article[data-testid="tweet"]');
        if (!tweet) return [];
        const images = tweet.querySelectorAll("img");
        const urls: string[] = [];
        images.forEach((img) => {
          const src = img.src;
          if (src && src.includes("twimg.com/media")) {
            const highQualitySrc = src.replace(/&name=\w+$/, "&name=orig");
            urls.push(highQualitySrc);
          }
        });
        return urls;
      });

      console.log(`Found ${imageUrls.length} image(s):`, imageUrls);

      // Close the tab when done
      await imagePage.close();

      return imageUrls;
    } catch (error) {
      console.error("Error getting image URLs from tweet ID:", error);
      return [];
    }
  }

  private async extractHashtags(): Promise<string> {
    return await this.page.evaluate(() => {
      const tweetElement = document.querySelector(
        'article[data-testid="tweet"]'
      );
      if (!tweetElement) return "";

      // Extract hashtags
      const hashtagElements = tweetElement.querySelectorAll(
        'a[href*="/hashtag/"]'
      );
      if (hashtagElements.length > 0) {
        return Array.from(hashtagElements)
          .map((element) => {
            return element.textContent || "";
          })
          .join(" ");
      }
      return "";
    });
  }

  // Separate method to extract profile image URL
  private async extractProfileImageUrl(username: string): Promise<string> {
    // Check if we already have the profile image cached
    if (this.profileImageCache.has(username)) {
      console.log(`Using cached profile image for ${username}`);
      return this.profileImageCache.get(username) || "";
    }

    console.log(`Extracting profile image for ${username}...`);
    try {
      // Make sure we're on the user's profile page
      const currentUrl = await this.page.url();
      if (!currentUrl.includes(`twitter.com/${username}`)) {
        await this.page.goto(`https://twitter.com/${username}`, {
          waitUntil: "networkidle2",
        });
      }

      // Allow a moment for the profile to load completely
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const profilePicUrl = await this.page.evaluate((username) => {
        // Try to find the profile photo link specific to this user
        const photoAnchor = document.querySelector(
          `a[href="/${username}/photo"][aria-label*="Opens profile photo"]`
        );

        if (photoAnchor) {
          const img = photoAnchor.querySelector(
            'img[alt="Opens profile photo"]'
          ) as HTMLImageElement | null;

          if (img && img.src) {
            return img.src;
          }
        }

        // Fallback: Try to find an image in the profile header
        const headerImg = document.querySelector(
          'a[href*="photo"] img[src*="profile_images"]'
        ) as HTMLImageElement | null;

        if (headerImg && headerImg.src) {
          return headerImg.src;
        }

        return "";
      }, username);

      console.log("Profile Picture URL:", profilePicUrl);

      // Cache the profile image URL
      if (profilePicUrl) {
        this.profileImageCache.set(username, profilePicUrl);
      }

      return profilePicUrl;
    } catch (error) {
      logger.error(`Error extracting profile image for ${username}:`, error);
      return "";
    }
  }

  async getLatestTweet(username: string): Promise<STweet | null> {
    try {
      // First, make sure we have the profile image (either from cache or extract it)
      const profileImageUrl = await this.extractProfileImageUrl(username);

      // Now navigate to the user's page to get the latest tweet
      await this.page.goto(`https://twitter.com/${username}`, {
        waitUntil: "networkidle2",
      });
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for the page to load completely
      // Check if we're on the right page
      console.log(`Navigated to: https://twitter.com/${username}`);

      // Make sure we're at the top of the page
      await this.page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      // Wait for tweet to load
      await this.page.waitForSelector('article[data-testid="tweet"]', {
        timeout: 20000,
      });

      const tweetData = await this.page.evaluate(
        (username, profileImageUrl) => {
          // const tweetElement = document.querySelector(
          //   'article[data-testid="tweet"]'
          // );

          const tweetElements = document.querySelectorAll(
            'article[data-testid="tweet"]'
          );
          if (!tweetElements || tweetElements.length === 0) return null;
          const firstTweet = tweetElements[0];
          const isPinned = !!firstTweet
            .querySelector(
              'div[data-testid="socialContext"][role="presentation"]:not([style*="display: none"])'
            )
            ?.textContent?.includes("Pinned");

          // Select the appropriate tweet - if first is pinned, use the second tweet (if available)
          const tweetElement =
            isPinned && tweetElements.length > 1
              ? tweetElements[1]
              : tweetElements[0];

          if (isPinned) {
            console.log("Skipping pinned tweet and using the next tweet");
          }

          if (!tweetElement) return null;

          const tweetLink = tweetElement.querySelector('a[href*="/status/"]');
          const tweetId = tweetLink?.getAttribute("href")?.split("/status/")[1];
          const textElement = tweetElement.querySelector(
            'div[data-testid="tweetText"]'
          );
          const timeElement = tweetElement.querySelector("time");
          const timestamp = timeElement?.getAttribute("datetime") || "";

          // Extract username/author_id
          const authorElement = tweetElement.querySelector(
            'div[data-testid="User-Name"] a'
          );
          const authorId = authorElement
            ? authorElement.getAttribute("href")?.replace("/", "") || username
            : username;

          // Extract likes, retweets, replies and quotes
          const likesElement = tweetElement.querySelector(
            'div[data-testid="like"] span[data-testid="app-text-transition-container"]'
          );
          const likeCount = likesElement
            ? parseInt(likesElement.textContent?.replace(/,/g, "") || "0", 10)
            : 0;

          // Extract retweets
          const retweetsElement = tweetElement.querySelector(
            'div[data-testid="retweet"] span[data-testid="app-text-transition-container"]'
          );
          const retweetCount = retweetsElement
            ? parseInt(
                retweetsElement.textContent?.replace(/,/g, "") || "0",
                10
              )
            : 0;

          // Extract comments (replies)
          const replyElement = tweetElement.querySelector(
            'div[data-testid="reply"] span[data-testid="app-text-transition-container"]'
          );
          const replyCount = replyElement
            ? parseInt(replyElement.textContent?.replace(/,/g, "") || "0", 10)
            : 0;

          // We can't reliably get quote count from the UI, so default to 0
          const quoteCount = 0;

          return {
            author_id: authorId,
            tweet_id: tweetId || "",
            text: textElement?.textContent || "",
            username: username,
            media: [] as IMedia[], // Initialize media as an empty array with explicit type
            hashtags: "", // Initialize hashtags as an empty string
            created_at: timestamp,
            profile_image_url: profileImageUrl, // Use the cached profile image
            retweet_count: retweetCount,
            like_count: likeCount,
            reply_count: replyCount,
            quote_count: quoteCount,
            hasVideo: false,
          };
        },
        username,
        profileImageUrl
      );

      if (!tweetData || !tweetData.tweet_id) {
        console.log(`No valid tweet found for ${username}`);
        return null;
      }

      const lastTweetId = this.lastKnownTweetIds.get(username);
      if (lastTweetId === tweetData.tweet_id) {
        console.log(`No new tweets for ${username} since last check`);
        return null;
      }

      // Check if the tweet has video
      const hasVideo = await this.page.evaluate(() => {
        const tweetElement = document.querySelector(
          'article[data-testid="tweet"]'
        );
        return !!(
          tweetElement?.querySelector('div[data-testid="videoPlayer"]') ||
          tweetElement?.querySelector("video")
        );
      });

      tweetData.hasVideo = hasVideo;

      // Extract hashtags
      tweetData.hashtags = await this.extractHashtags();

      // In getLatestTweet method, replace the image extraction code with:
      if (tweetData.tweet_id) {
        const imageUrls = await this.getImageUrlsFromTweetId(
          tweetData.tweet_id
        );
        console.log(
          `Found ${imageUrls.length} images in tweet from ${username}`,
          imageUrls
        );

        // Process images
        for (let i = 0; i < imageUrls.length; i++) {
          const mediaItem: IMedia = {
            media_key: `${tweetData.tweet_id}_img_${i}`,
            type: "photo",
            urls: [imageUrls[i]],
            preview_image_url: imageUrls[i],
            alt_text: "Image",
          };
          tweetData.media.push(mediaItem);
        }
      }

      // Process video if present
      if (hasVideo) {
        console.log(
          `⏳ Video detected in ${username}'s tweet, waiting for video URL to load...`
        );
        // We'll need to go to the specific tweet to get the video URL
        const videoUrl = await this.getVideoUrlFromTweetId(tweetData.tweet_id);

        if (videoUrl) {
          console.log(`📹 Video URL found for ${username}:`, videoUrl);
          const videoMedia: IMedia = {
            media_key: `${tweetData.tweet_id}_video`,
            type: "video",
            urls: [videoUrl],
            // preview_image_url: imageUrls.length > 0 ? imageUrls[0] : undefined,
          };
          tweetData.media.push(videoMedia);
        } else {
          console.log(`Could not extract video found in ${username}'s tweet`);
        }

        // Need to navigate back to the user's page for next monitoring interval
        await this.page.goto(`https://twitter.com/${username}`, {
          waitUntil: "networkidle2",
        });
      }

      this.lastKnownTweetIds.set(username, tweetData.tweet_id);
      return tweetData;
    } catch (error) {
      logger.error(`Error scraping latest tweet from ${username}:`, error);
      return null;
    }
  }

  async saveTweetToDatabase(tweet: STweet): Promise<ITweet | null> {
    try {
      // Convert STweet to database model format if needed
      const tweetToSave = new Tweet({
        tweet_id: tweet.tweet_id,
        author_id: tweet.author_id,
        text: tweet.text,
        username: tweet.username,
        media: tweet.media,
        hashtags: tweet.hashtags,
        profile_image_url: tweet.profile_image_url,
        retweet_count: tweet.retweet_count,
        like_count: tweet.like_count,
        reply_count: tweet.reply_count,
        quote_count: tweet.quote_count,
        hasVideo: tweet.hasVideo,
      });

      // Save to database
      const savedTweet = await tweetToSave.save();
      logger.info(
        `Tweet from @${tweet.username} saved to database with ID: ${savedTweet._id}`
      );

      return savedTweet.toObject();
    } catch (error) {
      logger.error("Error saving tweet to database:", error);
      throw error;
    }
  }

  async monitorAccount(
    username: string,
    checkInterval: number = 60000,
    onNewTweet?: (tweet: STweet) => Promise<void>
  ): Promise<void> {
    console.log(`Started monitoring tweets for @${username}`);
    console.log(`Checking every ${checkInterval / 1000} seconds`);

    // Clear any existing interval for this username
    if (this.monitoringIntervals.has(username)) {
      clearInterval(this.monitoringIntervals.get(username)!);
    }

    // First visit: get profile image and initialize with the latest tweet
    await this.extractProfileImageUrl(username);
    await this.getLatestTweet(username);

    const interval = setInterval(async () => {
      try {
        const newTweet = await this.getLatestTweet(username);
        if (newTweet) {
          console.log(`New tweet found from ${username}, processing...`);

          if (onNewTweet) {
            await onNewTweet(newTweet);
          }
          // Default behavior if no callback is provided can be added here
        }
      } catch (error) {
        logger.error(`Error in monitoring interval for ${username}:`, error);
      }
    }, checkInterval);

    this.monitoringIntervals.set(username, interval);
  }

  // Stop monitoring a specific account
  stopMonitoringAccount(username: string): void {
    if (this.monitoringIntervals.has(username)) {
      clearInterval(this.monitoringIntervals.get(username)!);
      this.monitoringIntervals.delete(username);
      console.log(`Stopped monitoring tweets for @${username}`);
    }
  }

  // Stop monitoring all accounts
  stopAllMonitoring(): void {
    for (const [username, interval] of this.monitoringIntervals.entries()) {
      clearInterval(interval);
      console.log(`Stopped monitoring tweets for @${username}`);
    }
    this.monitoringIntervals.clear();
  }
}

export class MultiAccountTwitterScraper {
  private browser: Browser;
  private pagePool: Map<string, Page> = new Map();
  private scrapers: Map<string, TwitterScraper> = new Map();

  constructor(browser: Browser) {
    this.browser = browser;
  }

  async addAccount(
    username: string,
    checkInterval: number = frequency,
    onNewTweet?: (tweet: STweet) => Promise<void>
  ): Promise<void> {
    // Check if already monitoring this account
    if (this.scrapers.has(username)) {
      console.log(`Already monitoring @${username}`);
      return;
    }

    try {
      // Create a new page for this account
      const page = await this.browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      // Store the page in our pool
      this.pagePool.set(username, page);

      // Create a new scraper for this account
      const scraper = new TwitterScraper(page);
      this.scrapers.set(username, scraper);

      // Start monitoring this account
      await scraper.monitorAccount(username, checkInterval, onNewTweet);
      console.log(`✅ Now monitoring @${username} on a dedicated page`);
    } catch (error) {
      logger.error(`Error setting up monitoring for @${username}:`, error);
    }
  }

  removeAccount(username: string): void {
    const scraper = this.scrapers.get(username);
    const page = this.pagePool.get(username);

    if (scraper) {
      scraper.stopMonitoringAccount(username);
      this.scrapers.delete(username);
    }

    if (page) {
      page
        .close()
        .catch((err) =>
          logger.error(`Error closing page for @${username}:`, err)
        );
      this.pagePool.delete(username);
    }

    console.log(`Removed monitoring for @${username}`);
  }

  getMonitoredAccounts(): string[] {
    return Array.from(this.scrapers.keys());
  }

  stopAllMonitoring(): void {
    // Stop all scrapers
    for (const [username, scraper] of this.scrapers.entries()) {
      scraper.stopMonitoringAccount(username);
    }

    // Close all pages
    for (const [username, page] of this.pagePool.entries()) {
      page
        .close()
        .catch((err) =>
          logger.error(`Error closing page for @${username}:`, err)
        );
    }

    this.scrapers.clear();
    this.pagePool.clear();
    console.log("Stopped monitoring all accounts");
  }
}

export async function saveTweetToDatabase(tweet: STweet): Promise<ITweet> {
  try {
    // First, ensure media is properly structured
    // Check if each media item has the expected structure
    const mediaArray = tweet.media
      .map((item) => {
        // If item is already properly structured
        if (typeof item === "object" && item !== null) {
          return {
            media_key: item.media_key,
            type: item.type,
            urls: Array.isArray(item.urls)
              ? item.urls
              : [item.urls].filter(Boolean),
            preview_image_url: item.preview_image_url,
            alt_text: item.alt_text || "Image",
          };
        }
        // If item somehow became a string (stringified JSON)
        else if (typeof item === "string") {
          try {
            const parsed = JSON.parse(item);
            return {
              media_key: parsed.media_key,
              type: parsed.type,
              urls: Array.isArray(parsed.urls)
                ? parsed.urls
                : [parsed.urls].filter(Boolean),
              preview_image_url: parsed.preview_image_url,
              alt_text: parsed.alt_text || "Image",
            };
          } catch (e) {
            logger.error("Failed to parse media item:", e);
            return null;
          }
        }
        return null;
      })
      .filter(Boolean); // Remove any null items

    // Create the Tweet document with the properly processed media array
    const tweetToSave = new Tweet({
      tweet_id: tweet.tweet_id,
      author_id: tweet.author_id,
      text: tweet.text,
      username: tweet.username,
      media: mediaArray,
      hashtags: tweet.hashtags,
      profile_image_url: tweet.profile_image_url,
      retweet_count: tweet.retweet_count,
      like_count: tweet.like_count,
      reply_count: tweet.reply_count,
      quote_count: tweet.quote_count,
      hasVideo: tweet.hasVideo,
    });

    // Save to database
    const savedTweet = await tweetToSave.save();
    logger.info(
      `Tweet from @${tweet.username} saved to database with ID: ${savedTweet._id}`
    );

    return savedTweet.toObject();
  } catch (error) {
    logger.error("Error saving tweet to database:", error);
    throw error;
  }
}

export const startMultiAccountScraping = async (
  browser: Browser,
  usersToTrack: string[],
  callbackFn?: (tweet: STweet) => Promise<void>
): Promise<MultiAccountTwitterScraper> => {
  const multiScraper = new MultiAccountTwitterScraper(browser);

  // Define a callback that saves to DB and emits socket event
  const handleNewTweet = async (tweet: STweet): Promise<void> => {
    try {
      // Save tweet to database
      const savedTweet = await saveTweetToDatabase(tweet);

      // Emit socket event to notify frontend
      console.log("New tweet emitted:", tweet);
      io.emit("new-tweet", savedTweet);

      // Also call the original callback if provided
      if (callbackFn) {
        await callbackFn(tweet);
      }
    } catch (error) {
      logger.error("Error in handleNewTweet function:", error);
    }
  };

  for (const username of usersToTrack) {
    await multiScraper.addAccount(username, frequency, handleNewTweet);
  }

  console.log(
    `✅ Now monitoring tweets from ${
      usersToTrack.length
    } accounts: ${usersToTrack.join(", ")}`
  );
  return multiScraper;
};

const puppeteer = require("puppeteer");
const fs = require("fs/promises");
const path = require("path");

/**
 * Twitter Scraper - Fetches latest tweets from given accounts
 * Usage: node twitter-scraper.js --accounts username1,username2,username3 [--clear-session]
 */

// Configuration
const config = {
  outputDir: "./tweets",
  outputFile: "tweets.json",
  loginRequired: true, // Set to false if you want to try without login
  headless: false, // Set to true for production use
  tweetLimit: 1, // Number of tweets to fetch per account
  // Add your Twitter credentials here
  credentials: {
    username: "_d_aslan",
    password: "t3rm1nat0r",
  },
};

// Twitter URLs
const BASE_URL = "https://twitter.com/";
const LOGIN_URL = "https://twitter.com/login";

// Get user data directory for persistent sessions
const getUserDataDir = (username: any) => {
  return path.resolve(__dirname, "user_data", username);
};

// Parse command line arguments
const parseArgs = () => {
  const args = process.argv.slice(2);
  const accounts = [
    "lynk0x",
    "Dior100x",
    "olur0cks",
    "blknoiz06",
    "henokcrypto",
    "blknoiz06",
    "cheatcoiner",
    "DegenerateNews",
    "frankdegods",
    "aeyakovenko",
    "solNfts",
    "solana",
    "solanaNFTs",
    "naiivememe",
    "party_fi",
    "suganarium",
    "deanbulla",
  ];

  // Allow clearing session before starting
  let clearSessionFlag = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--accounts" && args[i + 1]) {
      accounts.push(...args[i + 1].split(",").map((a) => a.trim()));
      i++;
    } else if (args[i] === "--clear-session") {
      clearSessionFlag = true;
    }
  }

  if (accounts.length === 0) {
    console.log(
      "Usage: node twitter-scraper.js --accounts username1,username2,username3"
    );
    process.exit(1);
  }

  return { accounts, clearSessionFlag };
};

// Sleep utility function
const sleep = (ms: any) => new Promise((resolve) => setTimeout(resolve, ms));

// Generate a unique MongoDB-like ObjectId
const generateObjectId = () => {
  const timestamp = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0");
  const machineId = Math.floor(Math.random() * 16777216)
    .toString(16)
    .padStart(6, "0");
  const processId = Math.floor(Math.random() * 65536)
    .toString(16)
    .padStart(4, "0");
  const counter = Math.floor(Math.random() * 16777216)
    .toString(16)
    .padStart(6, "0");
  return timestamp + machineId + processId + counter;
};

// Clear previous session data for a user (optional utility function)
async function clearSession(username: any) {
  const userDataDir = getUserDataDir(username);
  try {
    await fs.rm(userDataDir, { recursive: true, force: true });
    console.log(`Session data for ${username} has been cleared.`);
  } catch (error) {
    // Directory might not exist, which is fine
    console.log(`No existing session for ${username} or error clearing it.`);
  }
}

// Login to Twitter with persistent session
async function loginToTwitter(page: any) {
  console.log("Logging in to Twitter...");

  try {
    await page.goto(LOGIN_URL);
    await page.waitForSelector('input[name="text"]', { visible: true });
    await page.type('input[name="text"]', config.credentials.username);
    console.log("Typing username...");
    await sleep(2000);

    await page.keyboard.press("Enter");
    await sleep(2000);

    await page.waitForSelector('input[name="password"]', { visible: true });
    await page.type('input[name="password"]', config.credentials.password);
    console.log("Typing password...");
    await sleep(2000);
    await page.keyboard.press("Enter");

    console.log("Logging in...");
    await sleep(3000);

    // Check for successful login
    await page.waitForSelector('a[aria-label="Profile"]', { timeout: 5000 });
    console.log("✅ Login successful!");
    return true;
  } catch (error) {
    // Check for login failure
    const errorText = await page.evaluate(() => {
      const errorElement: any = document.querySelector("div[role='alert']");
      return errorElement ? errorElement.innerText : null;
    });

    console.error(
      "❌ Login failed:",
      errorText ||
        "Unknown error. Check your credentials and confirm that you're not being rate-limited."
    );
    throw new Error("Failed to login to Twitter");
  }
}

// Set up video URL interception
async function setupVideoInterception(page: any) {
  const videoUrls = new Set();

  await page.setRequestInterception(true);

  page.on("request", async (request: any) => {
    try {
      await request.continue();
    } catch (err: any) {
      // Suppress already-handled requests or log for debugging
      if (!err.message.includes("Request is already handled")) {
        console.error("Request interception error:", err.message);
      }
    }
  });

  page.on("response", async (response: any) => {
    const url = response.url();
    if (
      url.includes(".mp4") ||
      url.includes("video.twimg.com") ||
      url.includes("video_url") ||
      url.includes("amplify_video")
    ) {
      videoUrls.add(url);
    }
  });

  return videoUrls;
}

// Wait for a condition to be true
async function waitForCondition(
  page: any,
  conditionFn: any,
  timeout = 30000,
  checkInterval = 500
) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await conditionFn()) {
      return true;
    }
    await sleep(checkInterval);
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

// Get video URL from tweet ID
async function getVideoUrlFromTweetId(page: any, tweetId: any) {
  try {
    const videoUrls = await setupVideoInterception(page);

    await page.goto(`https://twitter.com/i/web/status/${tweetId}`, {
      waitUntil: "networkidle2",
    });

    await page.evaluate(() => {
      const videoPlayer: any = document.querySelector(
        'div[data-testid="videoPlayer"]'
      );
      if (videoPlayer) {
        videoPlayer.click();
      }
    });

    await waitForCondition(
      page,
      async () => {
        const videoExists = await page.evaluate(
          () => document.querySelector("video") !== null
        );
        return videoExists;
      },
      30000,
      500
    );

    await sleep(3000);

    if (videoUrls.size > 0) {
      return Array.from(videoUrls)[0];
    }

    return null;
  } catch (error) {
    console.error("Error getting video URL from tweet ID:", error);
    return null;
  }
}

// Extract tweet data from the page
async function extractTweetData(page: any, username: any) {
  console.log(`Extracting tweet data for ${username}...`);

  try {
    // Wait for tweets to load
    await page.waitForSelector('article[data-testid="tweet"]', {
      timeout: 10000,
    });

    // Get all tweets
    const tweets = await page.$$('article[data-testid="tweet"]');
    if (tweets.length === 0) {
      console.log(`No tweets found for ${username}`);
      return null;
    }

    // Check for pinned tweet and skip it if present
    let tweet: any;
    for (let i = 0; i < tweets.length; i++) {
      const isPinned = await page.evaluate((el: any) => {
        return (
          el.innerHTML.includes("Pinned") ||
          el
            .querySelector('[data-testid="socialContext"]')
            ?.textContent?.includes("Pinned")
        );
      }, tweets[i]);

      if (!isPinned) {
        tweet = tweets[i];
        break;
      }
    }

    // If all tweets are pinned (rare), use the first one
    if (!tweet && tweets.length > 0) {
      tweet = tweets[0];
    }

    // Extract tweet text
    const textElement = await tweet.$('div[data-testid="tweetText"]');
    const text = textElement
      ? await page.evaluate((el: any) => el.textContent, textElement)
      : "";

    // Extract tweet ID from the URL
    const tweetLinkElement = await tweet.$('a[href*="/status/"]');
    const tweetUrl = tweetLinkElement
      ? await page.evaluate(
          (el: any) => el.getAttribute("href"),
          tweetLinkElement
        )
      : "";
    const tweet_id = tweetUrl.split("/status/")[1];

    // Extract media if present
    const media = [];
    const mediaElements = await tweet.$$(
      'img[src*="https://pbs.twimg.com/media"]'
    );

    for (let i = 0; i < mediaElements.length; i++) {
      const mediaElement = mediaElements[i];
      const mediaUrl = await page.evaluate((el: any) => el.src, mediaElement);

      // Skip small images (likely profile pictures)
      if (mediaUrl.includes("profile_images")) continue;

      const mediaKey = `${tweet_id}_img_${i}`;

      // Replace image size parameters to get original image
      const originalMediaUrl = mediaUrl.replace(/&name=\w+/, "&name=orig");

      media.push({
        media_key: mediaKey,
        type: "photo",
        urls: [originalMediaUrl],
        preview_image_url: originalMediaUrl,
        alt_text: "Image",
        _id: {
          $oid: generateObjectId(),
        },
      });
    }

    // Extract engagement counts
    const getCount = async (testId: any) => {
      const countElement = await tweet.$(`div[data-testid="${testId}"]`);
      if (!countElement) return 0;

      const countText = await page.evaluate(
        (el: any) => el.textContent,
        countElement
      );
      const count = parseInt(countText.replace(/[^0-9]/g, "")) || 0;
      return count;
    };

    const retweet_count = await getCount("retweet");
    const like_count = await getCount("like");
    const reply_count = await getCount("reply");

    // Extract profile image
    const profile_image_url = await page.evaluate((username: any) => {
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

    // Check for videos
    const hasVideo = !!(await tweet.$('div[data-testid="videoPlayer"]'));

    // Get video URL if it exists
    let videoUrl = null;
    if (hasVideo && tweet_id) {
      // Save current page URL to return to later
      const currentUrl = page.url();

      // Get video URL
      videoUrl = await getVideoUrlFromTweetId(page, tweet_id);

      // Return to the profile page
      await page.goto(currentUrl, { waitUntil: "networkidle2" });
    }

    // If there's a video, add it to media
    if (hasVideo && videoUrl) {
      const mediaKey = `${tweet_id}_video_0`;
      media.push({
        media_key: mediaKey,
        type: "video",
        urls: [videoUrl],
        preview_image_url: "", // Video thumbnail would go here if available
        alt_text: "Video",
        _id: {
          $oid: generateObjectId(),
        },
      });
    }

    // Compile tweet data
    const tweetData = {
      _id: { $oid: generateObjectId() },
      author_id: username.toLowerCase(),
      tweet_id,
      text,
      username,
      media,
      hashtags: "",
      profile_image_url,
      retweet_count: { $numberInt: retweet_count.toString() },
      like_count: { $numberInt: like_count.toString() },
      reply_count: { $numberInt: reply_count.toString() },
      quote_count: { $numberInt: "0" },
      hasVideo,
      created_at: { $date: { $numberLong: Date.now().toString() } },
      createdAt: { $date: { $numberLong: Date.now().toString() } },
      updatedAt: { $date: { $numberLong: Date.now().toString() } },
      __v: { $numberInt: "0" },
    };

    return tweetData;
  } catch (error: any) {
    console.error(
      `Error extracting tweet data for ${username}:`,
      error.message
    );
    return null;
  }
}

// Main scraping function
async function scrapeTweets() {
  const { accounts, clearSessionFlag } = parseArgs();
  console.log(`Starting Twitter scraper for accounts: ${accounts.join(", ")}`);

  // Clear session if requested
  if (clearSessionFlag) {
    await clearSession(config.credentials.username);
  }

  // Get user data directory for browser session
  const userDataDir = getUserDataDir(config.credentials.username);

  const browser = await puppeteer.launch({
    headless: config.headless,
    defaultViewport: { width: 1440, height: 1080 },
    userDataDir: userDataDir,
  });

  const page = await browser.newPage();

  try {
    // Create output directory if it doesn't exist
    await fs.mkdir(config.outputDir, { recursive: true });

    // Disable request interception initially
    await page.setRequestInterception(false);

    // Go to Twitter base URL first
    await page.goto(BASE_URL);
    await sleep(2000);

    // Login if required
    if (config.loginRequired) {
      // Check if already logged in by looking for profile link
      const isLoggedIn = await page.evaluate(() => {
        return document.querySelector('a[aria-label="Profile"]') !== null;
      });

      if (!isLoggedIn) {
        await loginToTwitter(page);
      } else {
        console.log("Already logged in. Using existing session.");
      }

      await sleep(2000);
    }

    const allTweets = [];

    // Process each account
    for (const username of accounts) {
      console.log(`Processing account: ${username}`);

      try {
        // Navigate to user profile
        await page.goto(`https://twitter.com/${username}`, {
          waitUntil: "networkidle2",
        });

        // Extract tweet data
        const tweetData = await extractTweetData(page, username);

        if (tweetData) {
          allTweets.push(tweetData);
          console.log(`Successfully extracted tweet from ${username}`);
        }

        // Add some delay between accounts to avoid rate limiting
        await sleep(3000);
      } catch (error: any) {
        console.error(`Error processing account ${username}:`, error.message);
        continue;
      }
    }

    // Save tweets to JSON file
    const outputPath = path.join(config.outputDir, config.outputFile);
    await fs.writeFile(outputPath, JSON.stringify(allTweets, null, 2));

    console.log(
      `Successfully saved ${allTweets.length} tweets to ${outputPath}`
    );
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    await browser.close();
  }
}

// Run the scraper
scrapeTweets().catch(console.error);
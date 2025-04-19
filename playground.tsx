const puppeteer = require("puppeteer");

async function getImageUrlsFromTweetId(tweetId: string): Promise<string[]> {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`https://twitter.com/i/web/status/${tweetId}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Wait for tweet content to load
    await page.waitForSelector('article[data-testid="tweet"]', {
      timeout: 15000,
    });

    // Wait briefly to ensure all images have loaded
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("Images loaded");

    const imageUrls = await page.evaluate(() => {
      const tweet = document.querySelector('article[data-testid="tweet"]');
      if (!tweet) return [];

      const images = tweet.querySelectorAll("img");
      const urls: string[] = [];

      images.forEach((img) => {
        const src = img.src;
        if (src && src.includes("twimg.com/media")) {
          // Remove quality suffix and append name=orig for full quality
          const highQualitySrc = src.replace(/&name=\w+$/, "&name=orig");
          urls.push(highQualitySrc);
        }
      });

      return urls;
    });

    console.log(`Found ${imageUrls.length} image(s):`, imageUrls);
    return imageUrls;
  } catch (error) {
    console.error("Error getting image URLs from tweet ID:", error);
    return [];
  }
}
const tweetId = "1912870564043399271"; // Replace with the actual tweet ID
getImageUrlsFromTweetId(tweetId);

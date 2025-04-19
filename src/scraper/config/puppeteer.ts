import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const BASE_URL = "https://twitter.com/";
const LOGIN_URL = "https://twitter.com/login";

let browser: any = null;
let page: any = null;

//changes here too
const getUserDataDir = (username: string) => {
  return path.resolve(__dirname, "../../user_data", username);
};

const twitter = {
  initialize: async (username: string) => {
    const userDataDir = getUserDataDir(username);

    // Ensure the user-specific data directory exists
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    browser = await puppeteer.launch({
      headless: false,

      defaultViewport: {
        width: 1440,
        height: 1080,
      },
      userDataDir: userDataDir,
    });
    page = await browser.newPage();
    await page.goto(BASE_URL);
    await new Promise((r) => setTimeout(r, 2000));
  },

  login: async (username: string, password: string) => {
    const userDataDir = getUserDataDir(username);
    console.log(userDataDir);
    ///changes the session check

    const sessionFiles = [
      "Cookies",
      "Cookies-journal",
      "Local Storage/leveldb",
      "Login Data",
      "Preferences",
    ];

    const isSessionAvailable = sessionFiles.some((file) =>
      fs.existsSync(path.join(userDataDir, "Default", file))
    );

    if (isSessionAvailable) {
      console.log(`🔄 Existing session(s) found, attempting to use...`);

      // Try to navigate to the profile to verify the session is still valid
      try {
        await page.goto(`${BASE_URL}${username}`);
        await page.waitForSelector('a[aria-label="Profile"]', {
          timeout: 5000,
        });
        console.log("✅ Existing session is valid!");
        return { browser, page };
      } catch (sessionError) {
        console.log("❌ Existing session is invalid. Proceeding with login...");
        // Continue to login process
      }
    }

    console.log(`🔑 No valid session found for ${username}. Logging in...`);

    try {
      await page.goto(LOGIN_URL);
      await page.waitForSelector('input[name="text"]', { visible: true });
      await page.type('input[name="text"]', username);
      console.log("Typing username...");
      await new Promise((r) => setTimeout(r, 2000));

      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 2000));

      await page.waitForSelector('input[name="password"]', { visible: true });
      await page.type('input[name="password"]', password);
      console.log("Typing password...");
      await new Promise((r) => setTimeout(r, 2000));
      await page.keyboard.press("Enter");

      console.log("Logging in...");

      await new Promise((r) => setTimeout(r, 3000));

      // Check for successful login
      await page.waitForSelector('a[aria-label="Profile"]', { timeout: 5000 });
      console.log("✅ Login successful!");
      return { browser, page };
    } catch (error) {
      // Check for login failure
      const errorText = await page.evaluate(() => {
        const errorElement = document.querySelector(
          "div[role='alert']"
        ) as HTMLElement;
        return errorElement ? errorElement.innerText : null;
      });

      console.log(
        "❌ Login failed:",
        errorText ||
          "Unknown error. Check your parameters and confirm that you're not being rate-limited."
      );
      return false;
    }
  },

  // Optional: Add a method to clear sessions
  clearSession: (username: string) => {
    const userDataDir = getUserDataDir(username);
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      console.log(`Session data for ${username} has been cleared.`);
    }
  },
};

export default twitter;

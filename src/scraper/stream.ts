const minimist = require("minimist");

import twitter from "./config/puppeteer";
import logger from "../logging/logger";
// import initializeDatabase from "./setup";
// Example usage
import puppeteer from 'puppeteer';
import { startMultiAccountScraping } from './scraper';

// (async () => {
//   const browser = await puppeteer.launch({ headless: false });
  
//   // Start monitoring multiple accounts

//   // Later, you can add more accounts
//   // await scraper.addAccount('NASA');
  
//   // Or remove accounts you no longer want to monitor
//   // scraper.removeAccount('elonmusk');
  
//   // When you're done, stop all monitoring
//   // scraper.stopAllMonitoring();
//   // browser.close();
// })();

(async () => {
  console.log("🚀 Starting database initialization...");
//   await initializeDatabase();
  console.log("✅ Database initialized successfully!");

  // // Handle both minimist-style and direct argument passing
  // const args = minimist(process.argv.slice(2));

  // // Priority: Named arguments > Positional arguments
  // const username = args.username || args.u || process.argv[2];
  // const password = args.password || args.p || process.argv[3];
  // // const userToTrack = args.account || args.a || process.argv[4];

  // if (!username || !password) {
  //   logger.error(
  //     "Usage: node script.js --username=<your_username> --password=<your_password> --account=<account_to_track>"
  //   );
  //   logger.error(
  //     "Alternatively: node script.js <username> <password> <account_to_track>"
  //   );
  //   process.exit(1);
  // }

  console.log("🚀 Starting Twitter scraper...");

  try {
    await twitter.initialize("_d_aslan");
    const result = await twitter.login("_d_aslan", "t3rm1nat0r");

    if (result) {
      const { page } = result;
      const scraper = await startMultiAccountScraping(page.browser(), 
        ['olur0cks', 'psyl0l', 'A5tralfox', ]
      );
          } else {
      logger.error("❌ Login failed.");
      process.exit(1);
    }
  } catch (error) {
    logger.error("❌ An error occurred during scraping:", error);
    process.exit(1);
  }
})();
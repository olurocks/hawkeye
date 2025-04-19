const express = require("express");
const dotenv = require("dotenv");
import { Request, Response } from "express";
import { startTwitterStream } from "./handlers/getTweetsStream";
import { connectDB } from "./config/database";
import { ACCOUNTS_TO_MONITOR } from "./utils/constants";
import path from "path"

dotenv.config();
connectDB();

const app = express();

app.get("/tweets", async (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'public','index.html'))
});

if (ACCOUNTS_TO_MONITOR.length > 0) {
    console.log(`Starting to monitor tweets from: ${ACCOUNTS_TO_MONITOR.join(', ')}`);
    startTwitterStream(ACCOUNTS_TO_MONITOR);
  } else {
    console.error('No accounts to monitor. Please set ACCOUNTS_TO_MONITOR environment variable.');
  }

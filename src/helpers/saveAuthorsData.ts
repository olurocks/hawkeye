import { Author } from "../models/author.model";
import { IAuthor } from "../utils/interfaces";
import { getProfileDetails } from "./getProfileDetails";
import { connectDb } from "../config/database";
import mongoose from "mongoose";
import { BEARER_TOKEN,  } from "../utils/constants";

// connectDb();
const db_username = process.env.MONGODB_USERNAME
const db_password = process.env.MONGODB_PASSWORD

const filterNewUsernames = async (usernames: string[]) => {
  const newList = (
    await Promise.all(
      usernames.map(async (authorname) => {
        const authorExists = await Author.findOne({ username: authorname });
        return authorExists ? null : authorname;
      })
    )
  ).filter(Boolean);
  return newList;
};

const saveAccounts = async () => {
  try {
    // Fetch members from the Twitter list
    await mongoose.connect(
      process.env.MONGODB_URI ||
        `mongodb+srv://${db_username}:${db_password}@cluster0.vzqjc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`,
      {
        auth: {
          username: process.env.MONGODB_USERNAME,
          password: process.env.MONGODB_PASSWORD,
        },
        authSource: "admin", // Typically 'admin' for authentication
      }
    );

    console.log("Successfully connected to MongoDB");
    const response = await fetch(
      "https://api.x.com/2/lists/1923446693082612078/members?user.fields=id,name,username,profile_image_url",
      {
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`, // Make sure to set this in your environment
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Twitter API request failed with status ${response.status}`
      );
    }

    const data = await response.json();

    if (!data.data || !data.data.length) {
      console.log("No accounts found in the Twitter list");
      return;
    }

    // Transform the Twitter API data into the format expected by your database
    const accountsToSave = data.data.map((user: any) => ({
      author_id: user.id,
      username: user.username,
      profile_image_url: user.profile_image_url,

      // Add any other required fields with default values if needed
    }));

    console.log(accountsToSave.length);

    // Save to database
    await Author.insertMany(accountsToSave);
    console.log("New authors saved successfully");
  } catch (error: any) {
    console.log("An error occurred while saving new accounts: ", error.message);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
};

const accounts = ["whalewatchalert", "SolJakey", "real86hands", "himgajiria"];
saveAccounts();

const dotenv = require("dotenv")
dotenv.config()

export const BASE_URL = process.env.BASE_URL
export const BEARER_TOKEN = process.env.BEARER_TOKEN   
export const X_API_KEY = process.env.X_API_KEY
export const X_API_SECRET= process.env.X_API_SECRET
export const ACCOUNTS_TO_MONITOR = ["_d_aslan", "olur0cks"];
export const PORT = process.env.PORT
export const frequency = 60000
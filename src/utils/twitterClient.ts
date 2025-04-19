import axios from "axios"

const BASE_URL = process.env.BASE_URL
const BEARER_TOKEN = process.env.BEARER_TOKEN   
const X_API_KEY = process.env.X_API_KEY
const X_API_SECRET= process.env.X_API_SECRET

export const twitterClient = axios.create({
    baseURL: BASE_URL,
    headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "x-api-key": X_API_KEY,
        "x-api-secret": X_API_SECRET
    }
}) 
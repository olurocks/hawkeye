import { twitterClient } from "./twitterClient"
import { BASE_URL } from "./constants"


export const getUserIdByUsername = async (username: string) => {
    try {
        const response = await twitterClient.get(`${BASE_URL}/users/by?username=${username}`)
        return response.data.data.id
    } catch (error: any) {
        throw new Error(`An error occured while fetching userId for @${username}: ${error.message}`)
        // return null
        
    }
    
}
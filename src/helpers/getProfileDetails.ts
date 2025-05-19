import { BEARER_TOKEN } from "../utils/constants";
import axios from "axios";
const token = BEARER_TOKEN

if (!token) {
  console.error("No Twitter bearer token provided in environment variables");
  process.exit(1);
}



export const getProfileDetails = async(usernames: string[]) => {
  try {
    const url = `https://api.twitter.com/2/users/by?usernames=${usernames.join(
      ","
    )}&user.fields=profile_image_url`;
    
    const response = await axios.get(url,{headers:{
        Authorization: `Bearer ${token}`
    }})

    if(!response){
        console.log("empty response")
    }

    return response.data.data.map((user: any) => ({
        author_id: user.id,
        username: user.username,
        profile_image_url:user.profile_image_url
    }))
    
    
      } catch (error) {
    console.error("Error fetching user IDs:", error);
    return [];
  }
}



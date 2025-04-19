const mongoose = require("mongoose")

const db_username = process.env.MONGODB_USERNAME
const db_password = process.env.MONGODB_PASSWORD


export const connectDB = async()=>{
    try{
        await mongoose.connect(`mongodb+srv://${db_username}:${db_password}@cluster0.vzqjc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`)
        console.log("MongoDB Connection Successful")

    } catch(error: any) {
        console.error("MongoDB connection error", error.message)
    }
}


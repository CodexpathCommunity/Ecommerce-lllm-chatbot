// Load environment variables from .env file (must be first import)
import "dotenv/config";
// Import Express framework for creating web server
import express, { Express, Request, Response } from "express";
// Import MongoDB client for database connection
import { MongoClient } from "mongodb";
// Import our custom AI agent function
import { callAgent } from "./agent";


// Create Express application instance
const app: Express = express()
// Import CORS middleware for handling cross-origin requests
import cors from 'cors'

app.use(cors())
app.use(express.json())


const client = new MongoClient(process.env.MONGODB_ATLAS_URI as string)

async function startServer() {
  try {
    // Establish connection to MongoDB Atlas
    await client.connect();
    // Ping MongoDB to verify connection is working
    await client.db("admin").command({ ping: 1 });
    // Log successful connection
    console.log("You successfully connected to MongoDB!");

    // Define root endpoint (GET /) - simple health check
    app.get("/", (req: Request, res: Response) => {
      // Send simple response to confirm server is running
      res.send("LangGraph Agent Server");
    });

    // Define endpoint for starting new conversations (POST /chat)
    app.post("/chat", async (req: Request, res: Response) => {
      // Extract user message from request body
      const initialMessage = req.body.message;
      // Generate unique thread ID using current timestamp
      const threadId = Date.now().toString();
      // Log the incoming message for debugging
      console.log(initialMessage);
      try {
        // Call our AI agent with the message and new thread ID
        const response = await callAgent(client, initialMessage, threadId);
        // Send successful response with thread ID and AI response
        res.json({ threadId, response });
      } catch (error) {
        console.error("Error starting conversation:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Define endpoint for continuing existing conversations (POST /chat/:threadId)
    app.post("/chat/:threadId", async (req: Request, res: Response) => {
   
      const { threadId } = req.params;
      const { message } = req.body;
      try {
        // Call AI agent with message and existing thread ID (continues conversation)
        const response = await callAgent(client, message, threadId);
        res.json({ response });
      } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    const PORT = process.env.PORT || 8000;
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}


startServer();
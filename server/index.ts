import "dotenv/config";
import express, { Express, Request, Response } from "express";
import { MongoClient } from "mongodb";
import { callAgent } from "./agent";


const app: Express = express()
import cors from 'cors'

app.use(cors())
app.use(express.json())


const client = new MongoClient(process.env.MONGODB_ATLAS_URI as string)

async function startServer() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("You successfully connected to MongoDB!");

    // Route to fetch all products
    app.get("/products", async (req: Request, res: Response) => {
      try {
        const db = client.db("inventory_database");
        const products = await db.collection("items").find().toArray();
        res.json(products);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ error: "Failed to fetch products" });
      }
    });

    // Route to fetch a product by ID
    app.get("/products/:id", async (req: Request, res: Response) => {
      try {
        const productId = req.params.id;
        const db = client.db("inventory_database");
        const product = await db
          .collection("items")
          .findOne({ _id: new ObjectId(productId) }); // Use ObjectId to parse the ID

        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }

        res.json(product);
      } catch (error) {
        console.error("Error fetching product:", error);
        res.status(500).json({ error: "Failed to fetch product" });
      }
    });

    app.get("/", (req: Request, res: Response) => {
      res.send("LangGraph Agent Server");
    });

    app.post("/chat", async (req: Request, res: Response) => {
      const initialMessage = req.body.message;
      const threadId = Date.now().toString();
      console.log(initialMessage);
      try {
        const response = await callAgent(client, initialMessage, threadId);
        res.json({ threadId, response });
      } catch (error) {
        console.error("Error starting conversation:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/chat/:threadId", async (req: Request, res: Response) => {
      const { threadId } = req.params;
      const { message } = req.body;
      try {
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
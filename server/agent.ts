import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"; 
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages"; 
import {
  ChatPromptTemplate, 
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StateGraph } from "@langchain/langgraph"; 
import { Annotation } from "@langchain/langgraph"; 
import { tool } from "@langchain/core/tools"; 
import { ToolNode } from "@langchain/langgraph/prebuilt"; 
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { MongoClient } from "mongodb"; 
import { z } from "zod";
import "dotenv/config"; 


async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(); 
    } catch (error: any) {
      // Check if it's a rate limit error (HTTP 429) and we have retries left
      if (error.status === 429 && attempt < maxRetries) {
        // Calculate exponential backoff delay: 2^attempt seconds, max 30 seconds
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.log(`Rate limit hit. Retrying in ${delay / 1000} seconds...`);
        // Wait for the calculated delay before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue; 
      }
      throw error; 
    }
  }
  throw new Error("Max retries exceeded");
}

export async function callAgent(
  client: MongoClient,
  query: string,
  thread_id: string
) {
  try {
    // Database configuration
    const dbName = "inventory_database";
    const db = client.db(dbName); 
    const collection = db.collection("items"); 

    // Define the state structure for the agent workflow
    const GraphState = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
      }),
    });

    // Create a custom tool for searching furniture inventory
    const itemLookupTool = tool(
      // The actual function that will be executed when tool is called
      async ({ query, n = 10 }) => {
        try {
          console.log("Item lookup tool called with query:", query);

          // Check if database has any data at all
          const totalCount = await collection.countDocuments();
          console.log(`Total documents in collection: ${totalCount}`);

          // Early return if database is empty
          if (totalCount === 0) {
            console.log("Collection is empty");
            return JSON.stringify({
              error: "No items found in inventory",
              message: "The inventory database appears to be empty",
              count: 0,
            });
          }

          // Get sample documents for debugging purposes
          const sampleDocs = await collection.find({}).limit(3).toArray();
          console.log("Sample documents:", sampleDocs);

          // Configuration for MongoDB Atlas Vector Search
          const dbConfig = {
            collection: collection, // MongoDB collection to search
            indexName: "vector_index", // Name of the vector search index
            textKey: "embedding_text", // Field containing the text used for embeddings
            embeddingKey: "embedding", // Field containing the vector embeddings
          };

          // Create vector store instance for semantic search using Google Gemini embeddings
          const vectorStore = new MongoDBAtlasVectorSearch(
            new GoogleGenerativeAIEmbeddings({
              apiKey: process.env.GOOGLE_API_KEY, // Google API key from environment
              model: "text-embedding-004", // Gemini embedding model
            }),
            dbConfig
          );

          console.log("Performing vector search...");
          // Perform semantic search using vector embeddings
          const result = await vectorStore.similaritySearchWithScore(query, n);
          console.log(`Vector search returned ${result.length} results`);

          // If vector search returns no results, fall back to text search
          if (result.length === 0) {
            console.log(
              "Vector search returned no results, trying text search..."
            );
            // MongoDB text search using regular expressions
            const textResults = await collection
              .find({
                $or: [
                  // OR condition - match any of these fields
                  { item_name: { $regex: query, $options: "i" } }, // Case-insensitive search in item name
                  { item_description: { $regex: query, $options: "i" } }, // Case-insensitive search in description
                  { categories: { $regex: query, $options: "i" } }, // Case-insensitive search in categories
                  { embedding_text: { $regex: query, $options: "i" } }, // Case-insensitive search in embedding text
                ],
              })
              .limit(n)
              .toArray(); // Limit results and convert to array

            console.log(`Text search returned ${textResults.length} results`);
            // Return text search results as JSON string
            return JSON.stringify({
              results: textResults,
              searchType: "text", // Indicate this was a text search
              query: query,
              count: textResults.length,
            });
          }

          // Return vector search results as JSON string
          return JSON.stringify({
            results: result,
            searchType: "vector", // Indicate this was a vector search
            query: query,
            count: result.length,
          });
        } catch (error: any) {
          // Log detailed error information for debugging
          console.error("Error in item lookup:", error);
          console.error("Error details:", {
            message: error.message,
            stack: error.stack,
            name: error.name,
          });

          // Return error information as JSON string
          return JSON.stringify({
            error: "Failed to search inventory",
            details: error.message,
            query: query,
          });
        }
      },
      // Tool metadata and schema definition
      {
        name: "item_lookup", // Tool name that the AI will reference
        description:
          "Gathers furniture item details from the Inventory database", // Description for the AI
        schema: z.object({
          // Input validation schema
          query: z.string().describe("The search query"), // Required string parameter
          n: z
            .number()
            .optional()
            .default(10) // Optional number parameter with default
            .describe("Number of results to return"),
        }),
      }
    );

    const tools = [itemLookupTool];
    const toolNode = new ToolNode<typeof GraphState.State>(tools);

  
    const model = new ChatGoogleGenerativeAI({
      model: "gemini-1.5-flash", 
      temperature: 0, 
      maxRetries: 0,
      apiKey: process.env.GOOGLE_API_KEY, 
    }).bindTools(tools);

    // Decision function: determines next step in the workflow
    function shouldContinue(state: typeof GraphState.State) {
      const messages = state.messages; // Get all messages
      const lastMessage = messages[messages.length - 1] as AIMessage; 

      if (lastMessage.tool_calls?.length) {
        return "tools"; 
      }
      return "__end__"; 
    }

    async function callModel(state: typeof GraphState.State) {
      return retryWithBackoff(async () => {
        const prompt = ChatPromptTemplate.fromMessages([
          [
            "system", // System message defines the AI's role and behavior
            `You are a helpful E-commerce Chatbot Agent for a furniture store. 

          IMPORTANT: You have access to an item_lookup tool that searches the furniture inventory database. 
          ALWAYS use this tool when customers ask about furniture items, even if the tool returns errors or empty results.

          When using the item_lookup tool:
          - If it returns results, provide helpful details about the furniture items
          - If it returns an error or no results, acknowledge this and offer to help in other ways
          - If the database appears to be empty, let the customer know that inventory might be being updated

          Current time: {time}`,
          ],
          new MessagesPlaceholder("messages"), // Placeholder for conversation history
        ]);

        const formattedPrompt = await prompt.formatMessages({
          time: new Date().toISOString(), 
          messages: state.messages, 
        });

        const result = await model.invoke(formattedPrompt);
        return { messages: [result] };
      });
    }

    // Build the workflow graph
    const workflow = new StateGraph(GraphState)
      .addNode("agent", callModel) 
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent") 
      .addConditionalEdges("agent", shouldContinue) 
      .addEdge("tools", "agent"); 


    const checkpointer = new MongoDBSaver({ client, dbName });
    const app = workflow.compile({ checkpointer });


    const finalState = await app.invoke(
      {
        messages: [new HumanMessage(query)], 
      },
      {
        recursionLimit: 15, 
        configurable: { thread_id: thread_id }, 
      }
    );

    const response =
      finalState.messages[finalState.messages.length - 1].content;
    console.log("Agent response:", response);

    return response; 
  } catch (error: any) {
    console.error("Error in callAgent:", error.message);

    if (error.status === 429) {
      // Rate limit error
      throw new Error(
        "Service temporarily unavailable due to rate limits. Please try again in a minute."
      );
    } else if (error.status === 401) {
      // Authentication error
      throw new Error(
        "Authentication failed. Please check your API configuration."
      );
    } else {
      // Generic error
      throw new Error(`Agent failed: ${error.message}`);
    }
  }
}
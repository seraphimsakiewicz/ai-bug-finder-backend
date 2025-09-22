import { Server } from "socket.io";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import dotenv from "dotenv";

// types/bug.ts
interface Bug {
  id: string;
  title: string;
  description: string;
  bugLines: number[]; // e.g. [34,55]
  filePath: string;
  fullCode: string[]; // e.g. ["line 1 of code goes here", "line 2 of code goes here"]
}

dotenv.config();

const io = new Server(3001, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

io.on("connection", (socket) => {
  console.log("Client connecteddd:", socket.id);

  socket.on("analyze-repo", async (repoUrl: string) => {
    try {
      socket.emit("analysis-progress", { message: "Starting analysis..." });
      const url = new URL(repoUrl);
      const [, repoOwner, repoName] = url.pathname.split("/");

      const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
      });

      socket.emit("analysis-progress", {
        message: "Fetching repository files...",
      });

      const treeResponse = await octokit.rest.git.getTree({
        owner: repoOwner,
        repo: repoName,
        tree_sha: "HEAD",
        recursive: "true",
      });
      const codeFiles = treeResponse.data.tree.filter((file) => {
        return (
          file.type === "blob" &&
          (file.path?.endsWith(".js") ||
            file.path?.endsWith(".tsx") ||
            file.path?.endsWith(".ts"))
        );
      });

      socket.emit("analysis-progress", {
        message: `Found ${codeFiles.length} code files. Starting security analysis...`,
      });

      const allBugs: Bug[] = [];

      const batchSize = 10; // Process 10 files at a time

      for (let i = 0; i < codeFiles.length; i += batchSize) {
        const batch = codeFiles.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(codeFiles.length / batchSize);

        socket.emit("analysis-progress", {
          message: `Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`,
        });

        const batchPromises = batch.map(async (codeFile) => {
          const fileResponse = await octokit.rest.repos.getContent({
            owner: repoOwner,
            repo: repoName,
            path: codeFile.path!,
          });

          if (
            !Array.isArray(fileResponse.data) &&
            fileResponse.data.type === "file"
          ) {
            const fileContent = Buffer.from(
              fileResponse.data.content,
              "base64"
            ).toString();

            const aiResponse = await client.responses.create({
              model: "gpt-5-nano",
              input: `Analyze this code for security vulnerabilities. If the code has no bugs return buggy:false, otherwise return buggy:true.
         Return ONLY valid JSON in this format:
  {
    "bugs": [
      {
        id: string;
        title: string;
        description: string;
        bugLines: number[]; // e.g. [startingLineOfBug,endingLineOfBug]
        filePath: ${codeFile.path};
        fullCode: string[]; // e.g. ["line 1 of code goes here", "line 2 of code goes here"]
      }
    ]
      "buggy": true | false
  }
  
  Code to analyze:
  ${fileContent}`,
            });

            return JSON.parse(aiResponse.output_text).bugs;
          }
          return [];
        });

        const batchResults = await Promise.all(batchPromises);
        allBugs.push(...batchResults.flat());

        // Small delay between batches
        if (i + batchSize < codeFiles.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      console.log("allBugs", allBugs);

      // ... move your existing analysis code here ...

      socket.emit("analysis-progress", { message: "Analysis complete!" });

      socket.emit("analysis-complete", {
        name: repoName,
        bugs: allBugs,
        count: codeFiles.length,
      });
    } catch (error: any) {
      socket.emit("analysis-error", { error: error.message ?? String(error) });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

console.log("Socket.io serverr running on port 3001");

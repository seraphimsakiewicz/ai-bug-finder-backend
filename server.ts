import { Server } from "socket.io";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

const io = new Server(3001, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("analyze-repo", async (repoUrl: string) => {
    try {
      // Your existing GitHub + OpenAI logic here
      const url = new URL(repoUrl);
      const [, repoOwner, repoName] = url.pathname.split("/");

      const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
      });

      const treeResponse = await octokit.rest.git.getTree({
        owner: repoOwner,
        repo: repoName,
        tree_sha: "HEAD",
        recursive: "true",
      });

      const codeFiles = treeResponse.data.tree
        .filter((file) => {
          return (
            file.type === "blob" &&
            (file.path?.endsWith(".js") ||
              file.path?.endsWith(".tsx") ||
              file.path?.endsWith(".ts"))
          );
        })
        .slice(0, 3);

      const allBugs = [];

      for (const codeFile of codeFiles) {
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
        "title": "Brief bug description",
        "description": "Detailed explanation", 
        "severity": "high|medium|low",
        "lineNumber": 42
        "filePath" ${codeFile.path}
      }
    ]
      "buggy": true | false
  }
  
  Code to analyze:
  ${fileContent}`,
          });
          const bugsData = JSON.parse(aiResponse.output_text);
          console.log("bugsData", bugsData);
          allBugs.push(...bugsData.bugs);
        }
      }
      console.log("allBugs", allBugs);

      // ... move your existing analysis code here ...

      //   socket.emit("analysis-complete", {
      //     name: repoName,
      //     bugs: allBugs,
      //     count: fileCount,
      //   });
    } catch (error) {
      socket.emit("analysis-error", { error: error.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

console.log("Socket.io server running on port 3001");

import { Server } from "socket.io";
import {
  parseRepoUrl,
  fetchRepoFiles,
  filterCodeFiles,
  processFilesWithSocketProgress,
} from "./utils.ts";

const io = new Server(3001, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("Sockets connected:", socket.id);

  socket.on("analyze-repo", async (repoUrl: string) => {
    try {
      console.log("analysis-progress", { message: "Starting analysis..." });
      socket.emit("analysis-progress", { message: "Starting analysis..." });

      const { repoOwner, repoName } = parseRepoUrl(repoUrl);

      socket.emit("analysis-progress", {
        message: "Fetching repository files...",
      });
      console.log("analysis-progress", {
        message: "Fetching repository files...",
      });

      const allFiles = await fetchRepoFiles(repoOwner, repoName);
      const codeFiles = filterCodeFiles(allFiles);

      socket.emit("analysis-progress", {
        message: `Found ${codeFiles.length} code files. Starting security analysis...`,
      });

      console.log("analysis-progress", {
        message: `Found ${codeFiles.length} code files. Starting security analysis...`,
      });

      // Process files with rate limiting and socket progress
      await processFilesWithSocketProgress(
        codeFiles,
        repoOwner,
        repoName,
        socket
      );

      socket.emit("analysis-progress", { message: "Analysis complete!" });
      console.log("analysis-progress", { message: "Analysis complete!" });

      socket.emit("analysis-complete", {
        name: repoName,
        count: codeFiles.length,
      });
      console.log("analysis-complete", {
        name: repoName,
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

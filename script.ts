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

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const repoUrl = "https://github.com/seraphimsakiewicz/evently";
const url = new URL(repoUrl);
const [, repoOwner, repoName] = url.pathname.split("/");

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

console.log("analysis-progress", {
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

console.log("analysis-progress", {
  message: `Found ${codeFiles.length} code files. Starting security analysis...`,
});

const allBugs: Bug[] = [];

const batchSize = 10; // Process 10 files at a time

for (let i = 0; i < codeFiles.length; i += batchSize) {
  const batch = codeFiles.slice(i, i + batchSize);
  const batchNumber = Math.floor(i / batchSize) + 1;
  const totalBatches = Math.ceil(codeFiles.length / batchSize);

  console.log("analysis-progress", {
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

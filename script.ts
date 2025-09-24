import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import dotenv from "dotenv";
import pLimit from "p-limit";

type Bug = {
  id: string;
  title: string;
  description: string;
  lines: number[];
};

dotenv.config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const repoUrl = "https://github.com/seraphimsakiewicz/evently";
console.time("myScan");
const url = new URL(repoUrl);
const [, repoOwner, repoName] = url.pathname.split("/");

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const limit = pLimit(13);

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
// .slice(0, 5);

console.log("analysis-progress", {
  message: `Found ${codeFiles.length} code files. Starting security analysis...`,
});

// Process individual file
async function processFile(codeFile: any): Promise<any> {
  try {
    const fileResponse = await octokit.rest.repos.getContent({
      owner: repoOwner,
      repo: repoName,
      path: codeFile.path!,
    });

    if (
      !Array.isArray(fileResponse.data) &&
      fileResponse.data.type === "file" &&
      typeof codeFile.path === "string"
    ) {
      const fileContent = Buffer.from(
        fileResponse.data.content,
        "base64"
      ).toString();

      const aiResponse = await client.responses.create({
        model: "gpt-5-nano",
        input: [
          {
            role: "system",
            content: "You are a code security auditor. Be concise and precise.",
          },
          {
            role: "user",
            content: [
              "Analyze this code for security vulnerabilities.",
              "Return an object { bugs: Bug[] }.",
              "If none are found, return { bugs: [] }.",
              "Each bug must include:",
              "- title: short summary",
              "- description: explanation of the bug",
              "- lines: [start, end] line numbers (use the same value twice if the bug is on one line, e.g. [42,42])",
              `\nFile path: ${codeFile.path}`,
              `Code to analyze:\n${fileContent}`,
            ].join("\n"),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "bugs_report",
            schema: {
              type: "object",
              properties: {
                bugs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      // tuple-like: exactly two integers >= 1
                      lines: {
                        type: "array",
                        minItems: 2,
                        maxItems: 2,
                        items: { type: "integer", minimum: 1 },
                      },
                    },
                    required: ["title", "description", "lines"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["bugs"],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      });

      // Strongly typed, already validated by Zod
      const parsedOutput = JSON.parse(aiResponse.output_text); // { bugs: Array<{title, description, lines}> }
      const bugsArray = parsedOutput?.bugs ?? [];
      const bugsWithIds: Bug[] = bugsArray.map((b: Omit<Bug, "id">) => ({
        id: crypto.randomUUID(),
        title: b.title,
        description: b.description,
        lines: b.lines, // tuple [start, end]
      }));

      return { [codeFile.path!]: bugsWithIds };
    } else {
      return { [codeFile.path!]: [] };
    }
  } catch (error: any) {
    console.error("Error fetching file content:", { error });
    return { error: error.message };
  }
}

// Process all files with rate limiting and progress tracking
await Promise.all(
  codeFiles.map((codeFile, index) =>
    limit(async () => {
      console.log("analysis-progress", {
        message: `Processing file ${index + 1}/${codeFiles.length}: ${
          codeFile.path
        }`,
      });
      const result = await processFile(codeFile);
      if (!result?.error) {
        console.log(
          `File analysis results for ${codeFile.path}: Mock sending to backend here ->`,
          JSON.stringify(result)
        );
      }
    })
  )
);

console.timeEnd("myScan");

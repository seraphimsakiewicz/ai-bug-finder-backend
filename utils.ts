import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import pLimit from "p-limit";
import dotenv from "dotenv";
dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type Bug = {
  id: string;
  title: string;
  description: string;
  lines: number[];
};

const ignoredDirs = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".next/",
  ".nuxt/",
  "__snapshots__/",
  "vendor/",
  ".venv/",
  "__pycache__/",
];

const ignoredExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".md",
  ".txt",
  ".lock",
  ".log",
  ".map",
];

export function parseRepoUrl(repoUrl: string) {
  const url = new URL(repoUrl);
  const [, repoOwner, repoName] = url.pathname.split("/");
  return { repoOwner, repoName };
}

export async function fetchRepoFiles(repoOwner: string, repoName: string) {
  const treeResponse = await octokit.rest.git.getTree({
    owner: repoOwner,
    repo: repoName,
    tree_sha: "HEAD",
    recursive: "true",
  });
  return treeResponse.data.tree;
}

export function filterCodeFiles(files: any[]) {
  return files.filter((file) => {
    if (file.type !== "blob") return false;

    const path = file.path ?? "";

    if (ignoredDirs.some((dir) => path.includes(dir))) return false;
    if (ignoredExtensions.some((ext) => path.endsWith(ext))) return false;

    return true;
  });
}

async function processFile(
  repoOwner: string,
  repoName: string,
  codeFile: any
): Promise<{ [key: string]: Bug[] } | { error: string }> {
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

      const parsedOutput = JSON.parse(aiResponse.output_text);
      const bugsArray = parsedOutput?.bugs ?? [];
      const bugsWithIds: Bug[] = bugsArray.map((b: Omit<Bug, "id">) => ({
        id: codeFile.sha,
        title: b.title,
        description: b.description,
        lines: b.lines,
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

export async function processFilesWithSocketProgress(
  files: any[],
  repoOwner: string,
  repoName: string,
  socket: any
) {
  const limit = pLimit(13);

  await Promise.all(
    files.map((codeFile) =>
      limit(async () => {
        socket.emit("analysis-progress", {
          message: `Processing ${codeFile.path}`,
        });

        const result = await processFile(repoOwner, repoName, codeFile);

        if (!("error" in result)) {
          // Extract bugs from result (result is { [filePath]: Bug[] })
          const filePath = Object.keys(result)[0];
          const bugs = result[filePath];

          // Emit individual file result
          socket.emit("file-analyzed", {
            filePath,
            bugs,
          });
        }
      })
    )
  );
}

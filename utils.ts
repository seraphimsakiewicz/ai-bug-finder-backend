import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import pLimit from "p-limit";

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

export async function fetchRepoFiles(octokit: Octokit, repoOwner: string, repoName: string) {
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

export async function processFile(
  octokit: Octokit,
  client: OpenAI,
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

export async function processAllFiles(
  files: any[],
  octokit: Octokit,
  client: OpenAI,
  repoOwner: string,
  repoName: string
) {
  const limit = pLimit(13);

  return Promise.all(
    files.map((codeFile, index) =>
      limit(async () => {
        console.log("analysis-progress", {
          message: `Processing file ${index + 1}/${files.length}: ${codeFile.path}`,
        });

        const result = await processFile(octokit, client, repoOwner, repoName, codeFile);

        if (!result?.error) {
          console.log(
            `File analysis results for ${codeFile.path}: Mock sending to backend here ->`,
            JSON.stringify(result, null, "\t")
          );
        }

        return result;
      })
    )
  );
}
import OpenAI from "openai";
import { z } from "zod";
import { appConfig } from "../config.js";
import { ArchiveAnalysis } from "../types.js";
import { chunkText, normalizeWhitespace, truncateText } from "../utils.js";

const todoSchema = z.object({
  title: z.string(),
  dueAt: z.string().nullable(),
  assignee: z.string().nullable(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1)
});

const archiveAnalysisSchema = z.object({
  title: z.string(),
  summary: z.string(),
  keywords: z.array(z.string()),
  tags: z.array(z.string()),
  todoCandidates: z.array(todoSchema),
  answerHints: z.array(z.string())
});

const client = appConfig.openAiApiKey ? new OpenAI({ apiKey: appConfig.openAiApiKey }) : null;

function heuristicKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#@-]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([token]) => token);
}

function heuristicTodoCandidates(text: string): ArchiveAnalysis["todoCandidates"] {
  const lines = text.split(/[\n。！？!?]/).map((item) => item.trim()).filter(Boolean);
  const todoVerbs = ["发送", "提交", "跟进", "回复", "安排", "确认", "完成", "更新", "整理", "输出", "准备"];
  return lines
    .filter((line) => todoVerbs.some((verb) => line.includes(verb)))
    .slice(0, 3)
    .map((line) => ({
      title: truncateText(line, 60),
      dueAt: null,
      assignee: null,
      evidence: truncateText(line, 160),
      confidence: 0.55
    }));
}

function heuristicAnalysis(input: string): ArchiveAnalysis {
  const cleaned = normalizeWhitespace(input);
  return {
    title: truncateText(cleaned || "Untitled capture", 50),
    summary: truncateText(cleaned || "No extractable text found.", 180),
    keywords: heuristicKeywords(cleaned),
    tags: heuristicKeywords(cleaned).slice(0, 4),
    todoCandidates: heuristicTodoCandidates(cleaned),
    answerHints: [truncateText(cleaned, 120)]
  };
}

export class AiService {
  async analyzeArchive(input: string): Promise<ArchiveAnalysis> {
    const cleanInput = normalizeWhitespace(input);
    if (!client || !cleanInput) {
      return heuristicAnalysis(cleanInput);
    }

    const response = await client.chat.completions.create({
      model: appConfig.openAiModel,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Classify forwarded WeChat content for a knowledge archive. Return JSON with title, summary, keywords, tags, todoCandidates, answerHints."
        },
        { role: "user", content: chunkText(cleanInput, 12000).join("\n\n") }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return heuristicAnalysis(cleanInput);
    }

    const parsed = archiveAnalysisSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return heuristicAnalysis(cleanInput);
    }
    return parsed.data;
  }

  async createEmbedding(input: string): Promise<number[]> {
    if (!client || !normalizeWhitespace(input)) {
      return [];
    }

    const response = await client.embeddings.create({
      model: appConfig.openAiEmbeddingModel,
      input: truncateText(input, 8000)
    });

    return response.data[0]?.embedding ?? [];
  }

  async answerFromResults(query: string, results: Array<{ title: string; summary: string | null; content: string }>): Promise<string> {
    const cleanQuery = normalizeWhitespace(query);
    if (!results.length) {
      return "No matching archived content was found.";
    }

    if (!client) {
      return `Top match: ${results[0].title}. ${results[0].summary ?? truncateText(results[0].content, 160)}`;
    }

    const context = results
      .slice(0, 5)
      .map((item, index) => `Result ${index + 1}\nTitle: ${item.title}\nSummary: ${item.summary ?? ""}\nContent: ${truncateText(item.content, 900)}`)
      .join("\n\n");

    const response = await client.chat.completions.create({
      model: appConfig.openAiModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Answer the user query using only the provided archive evidence. Mention uncertainty if evidence is weak."
        },
        {
          role: "user",
          content: `Query: ${cleanQuery}\n\nEvidence:\n${context}`
        }
      ]
    });

    return response.choices[0]?.message?.content?.trim() || `Top match: ${results[0].title}`;
  }
}

export const aiService = new AiService();

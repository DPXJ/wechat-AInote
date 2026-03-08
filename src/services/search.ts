import { aiService } from "./ai.js";
import { repositories } from "../repositories.js";
import { cosineSimilarity, normalizeWhitespace } from "../utils.js";

function tokenizeQuery(query: string): string {
  return normalizeWhitespace(query)
    .split(" ")
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, "")}"`)
    .join(" OR ");
}

export async function searchArchive(query: string) {
  const lexicalQuery = tokenizeQuery(query) || query;
  const lexical = repositories.searchArchiveLexical(lexicalQuery, 20);
  const likeMatches = repositories.searchArchiveByLike(query, 20);
  const embedding = await aiService.createEmbedding(query);
  const embeddingRows = repositories.getAllEmbeddings();

  const semanticScores = new Map<string, number>();
  if (embedding.length) {
    for (const row of embeddingRows) {
      semanticScores.set(row.archiveEntryId, cosineSimilarity(embedding, row.vector));
    }
  }

  const mergedMap = new Map<string, (typeof lexical)[number]>();
  for (const item of [...lexical, ...likeMatches]) {
    const existing = mergedMap.get(item.id);
    if (!existing || item.score > existing.score) {
      mergedMap.set(item.id, item);
    }
  }

  const mergedResults = [...mergedMap.values()]
    .map((item) => ({
      ...item,
      score: item.score + (semanticScores.get(item.id) ?? 0) * 3
    }))
    .sort((a, b) => b.score - a.score);

  const entries = mergedResults
    .slice(0, 5)
    .map((item) => repositories.getArchiveEntryById(item.id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const answer = await aiService.answerFromResults(
    query,
    entries.map((entry) => ({
      title: entry.title,
      summary: entry.summary,
      content: entry.content
    }))
  );

  return { answer, results: mergedResults };
}

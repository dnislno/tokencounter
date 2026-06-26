import { ASTPruner } from './pruner';

export interface FileProcessed {
  filename: string;
  filePath: string;
  originalTokens: number;
  prunedTokens: number;
  compressionRatio: number;
  prunedCode: string;
}

export interface DetectionResult {
  modifiedText: string;
  filesProcessed: FileProcessed[];
}

export interface CacheEntry {
  originalHash: string;
  prunedCode: string;
  originalTokens: number;
  prunedTokens: number;
  compressionRatio: number;
}

// Simple and high-performance string hashing algorithm
function getContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(16) + "@" + content.length;
}

export class FileBlockDetector {
  /**
   * Safe helper to extract the basename of a path (cross-platform).
   */
  private static pathBasename(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx === -1 ? normalized : normalized.substring(idx + 1);
  }

  /**
   * Safely extracts potential hydration keywords (function/class names) from the user prompt.
   */
  public static extractHydrationTargets(prompt: string): string[] {
    let cleanPrompt = prompt.replace(/```[\s\S]*?```/g, '');
    cleanPrompt = cleanPrompt.replace(/<file[\s\S]*?<\/file>/g, '');

    const words = cleanPrompt.split(/[^\w]+/);
    const targets = new Set<string>();
    
    for (const word of words) {
      if (word.length > 3 && !/^\d+$/.test(word)) {
        targets.add(word);
      }
    }
    
    return Array.from(targets);
  }

  /**
   * Scans a message text for file blocks, prunes non-relevant functions using AST parsing, and returns the modified text.
   * Leverages session-based cache to guarantee prefix stability and 100% KV cache hits across turns.
   */
  public static async detectAndPrune(
    messageText: string,
    userPromptContext: string,
    sessionCache?: Map<string, CacheEntry>
  ): Promise<DetectionResult> {
    const filesProcessed: FileProcessed[] = [];
    const hydrationTargets = this.extractHydrationTargets(userPromptContext);
    
    let modifiedText = messageText;

    // Pattern 1: Markdown Code Blocks preceded by a file path header
    const markdownPattern = /(?:(?:###\s+File:\s*|File:\s*|#\s*|(?:\r?\n|^))([a-zA-Z]:\\[^\r\n`]+|[^\r\n`]+\.[a-zA-Z0-9]+)\r?\n)```[a-zA-Z0-9\-]*\r?\n([\s\S]*?)\r?\n```/g;
    
    const markdownMatches: Array<{
      matchStr: string;
      filePath: string;
      codeContent: string;
    }> = [];

    let match;
    markdownPattern.lastIndex = 0;
    while ((match = markdownPattern.exec(messageText)) !== null) {
      markdownMatches.push({
        matchStr: match[0],
        filePath: match[1].trim(),
        codeContent: match[2]
      });
    }

    // Pattern 2: XML/HTML tags
    const xmlPattern = /<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/g;
    
    const xmlMatches: Array<{
      matchStr: string;
      filePath: string;
      codeContent: string;
    }> = [];

    xmlPattern.lastIndex = 0;
    while ((match = xmlPattern.exec(modifiedText)) !== null) {
      xmlMatches.push({
        matchStr: match[0],
        filePath: match[1].trim(),
        codeContent: match[2]
      });
    }

    // Run AST-based pruning in parallel across all detected files, utilizing cache when available
    const markdownPrunes = Promise.all(markdownMatches.map(async (m) => {
      const filename = this.pathBasename(m.filePath);
      const fileExt = m.filePath.split('.').pop() || '';
      const originalHash = getContentHash(m.codeContent);

      // Check session cache first
      if (sessionCache && sessionCache.has(m.filePath)) {
        const cached = sessionCache.get(m.filePath)!;
        if (cached.originalHash === originalHash) {
          const replacement = `\n${m.filePath}\n\`\`\`${fileExt}\n${cached.prunedCode}\n\`\`\``;
          return {
            matchStr: m.matchStr,
            replacement,
            fileInfo: {
              filename,
              filePath: m.filePath,
              originalTokens: cached.originalTokens,
              prunedTokens: cached.prunedTokens,
              compressionRatio: cached.compressionRatio,
              prunedCode: cached.prunedCode
            }
          };
        }
      }

      // Cache miss: execute AST pruner
      const pruneResult = await ASTPruner.prune(m.filePath, m.codeContent, hydrationTargets);
      
      if (sessionCache) {
        sessionCache.set(m.filePath, {
          originalHash,
          prunedCode: pruneResult.prunedCode,
          originalTokens: pruneResult.originalTokenEstimate,
          prunedTokens: pruneResult.prunedTokenEstimate,
          compressionRatio: pruneResult.compressionRatio
        });
      }

      const replacement = `\n${m.filePath}\n\`\`\`${fileExt}\n${pruneResult.prunedCode}\n\`\`\``;
      return {
        matchStr: m.matchStr,
        replacement,
        fileInfo: {
          filename,
          filePath: m.filePath,
          originalTokens: pruneResult.originalTokenEstimate,
          prunedTokens: pruneResult.prunedTokenEstimate,
          compressionRatio: pruneResult.compressionRatio,
          prunedCode: pruneResult.prunedCode
        }
      };
    }));

    const xmlPrunes = Promise.all(xmlMatches.map(async (m) => {
      const filename = this.pathBasename(m.filePath);
      const originalHash = getContentHash(m.codeContent);

      // Check session cache first
      if (sessionCache && sessionCache.has(m.filePath)) {
        const cached = sessionCache.get(m.filePath)!;
        if (cached.originalHash === originalHash) {
          const replacement = `<file path="${m.filePath}">\n${cached.prunedCode}\n</file>`;
          return {
            matchStr: m.matchStr,
            replacement,
            fileInfo: {
              filename,
              filePath: m.filePath,
              originalTokens: cached.originalTokens,
              prunedTokens: cached.prunedTokens,
              compressionRatio: cached.compressionRatio,
              prunedCode: cached.prunedCode
            }
          };
        }
      }

      // Cache miss: execute AST pruner
      const pruneResult = await ASTPruner.prune(m.filePath, m.codeContent, hydrationTargets);
      
      if (sessionCache) {
        sessionCache.set(m.filePath, {
          originalHash,
          prunedCode: pruneResult.prunedCode,
          originalTokens: pruneResult.originalTokenEstimate,
          prunedTokens: pruneResult.prunedTokenEstimate,
          compressionRatio: pruneResult.compressionRatio
        });
      }

      const replacement = `<file path="${m.filePath}">\n${pruneResult.prunedCode}\n</file>`;
      return {
        matchStr: m.matchStr,
        replacement,
        fileInfo: {
          filename,
          filePath: m.filePath,
          originalTokens: pruneResult.originalTokenEstimate,
          prunedTokens: pruneResult.prunedTokenEstimate,
          compressionRatio: pruneResult.compressionRatio,
          prunedCode: pruneResult.prunedCode
        }
      };
    }));

    const [resolvedMarkdown, resolvedXml] = await Promise.all([markdownPrunes, xmlPrunes]);

    // Apply markdown replacements
    for (const rep of resolvedMarkdown) {
      modifiedText = modifiedText.replace(rep.matchStr, rep.replacement);
      filesProcessed.push(rep.fileInfo);
    }

    // Apply XML replacements
    for (const rep of resolvedXml) {
      modifiedText = modifiedText.replace(rep.matchStr, rep.replacement);
      filesProcessed.push(rep.fileInfo);
    }

    return {
      modifiedText,
      filesProcessed
    };
  }
}

import { LexicalPruner } from './pruner';

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
    // 1. Strip out markdown code blocks to prevent self-hydration
    let cleanPrompt = prompt.replace(/```[\s\S]*?```/g, '');
    
    // 2. Strip out XML file blocks
    cleanPrompt = cleanPrompt.replace(/<file[\s\S]*?<\/file>/g, '');

    // 3. Extract words longer than 3 characters that are not purely numeric
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
   * Scans a message text for file blocks, prunes non-relevant functions, and returns the modified text.
   */
  public static detectAndPrune(messageText: string, userPromptContext: string): DetectionResult {
    const filesProcessed: FileProcessed[] = [];
    const hydrationTargets = this.extractHydrationTargets(userPromptContext);
    
    let modifiedText = messageText;

    // Pattern 1: Markdown Code Blocks preceded by a file path header
    // e.g.,
    // path/to/file.ts
    // ```typescript
    // code...
    // ```
    // We use a robust regex that matches:
    // Line 1: Optional file header label (e.g. "File: ", "### File: ", etc.) followed by path
    // Line 2: Opening markdown code block
    // Body: The code content
    // End: Closing code block
    const markdownPattern = /(?:(?:###\s+File:\s*|File:\s*|#\s*|(?:\r?\n|^))([a-zA-Z]:\\[^\r\n`]+|[^\r\n`]+\.[a-zA-Z0-9]+)\r?\n)```[a-zA-Z0-9\-]*\r?\n([\s\S]*?)\r?\n```/g;
    
    let match;
    const markdownReplacements: Array<{
      matchStr: string;
      replacement: string;
      fileInfo: FileProcessed;
    }> = [];

    markdownPattern.lastIndex = 0;
    while ((match = markdownPattern.exec(messageText)) !== null) {
      const matchStr = match[0];
      const filePath = match[1].trim();
      const codeContent = match[2];
      const filename = this.pathBasename(filePath);

      const pruneResult = LexicalPruner.prune(filePath, codeContent, hydrationTargets);
      
      const fileExt = filePath.split('.').pop() || '';
      const replacement = `\n${filePath}\n\`\`\`${fileExt}\n${pruneResult.prunedCode}\n\`\`\``;

      markdownReplacements.push({
        matchStr,
        replacement,
        fileInfo: {
          filename,
          filePath,
          originalTokens: pruneResult.originalTokenEstimate,
          prunedTokens: pruneResult.prunedTokenEstimate,
          compressionRatio: pruneResult.compressionRatio,
          prunedCode: pruneResult.prunedCode
        }
      });
    }

    // Apply markdown replacements
    for (const rep of markdownReplacements) {
      modifiedText = modifiedText.replace(rep.matchStr, rep.replacement);
      filesProcessed.push(rep.fileInfo);
    }

    // Pattern 2: XML/HTML tags (common in Cline/Aider agent prompts)
    // e.g., <file path="src/auth.ts">code...</file>
    const xmlPattern = /<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/g;
    const xmlReplacements: Array<{
      matchStr: string;
      replacement: string;
      fileInfo: FileProcessed;
    }> = [];

    xmlPattern.lastIndex = 0;
    while ((match = xmlPattern.exec(modifiedText)) !== null) {
      const matchStr = match[0];
      const filePath = match[1].trim();
      const codeContent = match[2];
      const filename = this.pathBasename(filePath);

      const pruneResult = LexicalPruner.prune(filePath, codeContent, hydrationTargets);
      const replacement = `<file path="${filePath}">\n${pruneResult.prunedCode}\n</file>`;

      xmlReplacements.push({
        matchStr,
        replacement,
        fileInfo: {
          filename,
          filePath,
          originalTokens: pruneResult.originalTokenEstimate,
          prunedTokens: pruneResult.prunedTokenEstimate,
          compressionRatio: pruneResult.compressionRatio,
          prunedCode: pruneResult.prunedCode
        }
      });
    }

    // Apply XML replacements
    for (const rep of xmlReplacements) {
      modifiedText = modifiedText.replace(rep.matchStr, rep.replacement);
      filesProcessed.push(rep.fileInfo);
    }

    return {
      modifiedText,
      filesProcessed
    };
  }
}

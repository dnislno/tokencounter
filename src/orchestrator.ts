import { FileBlockDetector, FileProcessed } from './detector';
import { LexicalPruner } from './pruner';

export interface OrchestrationResult {
  optimizedPayload: any;
  filesProcessed: FileProcessed[];
}

export class CacheOrchestrator {
  /**
   * Helper to determine if the target model supports Anthropic-style prompt caching.
   */
  private static supportsAnthropicCaching(modelName: string): boolean {
    const name = modelName.toLowerCase();
    return name.includes('claude-3-5') || name.includes('claude-3-opus') || name.includes('claude-3-sonnet');
  }

  /**
   * Orchestrates the incoming payload to guarantee and maximize Prompt Caching.
   */
  public static orchestrate(payload: any): OrchestrationResult {
    if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
      return { optimizedPayload: payload, filesProcessed: [] };
    }

    const messages = [...payload.messages];
    const model = payload.model || '';
    const isAnthropic = this.supportsAnthropicCaching(model);

    // 1. Extract the last user message to serve as the hydration context
    let userPromptContext = '';
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      if (typeof lastMsg.content === 'string') {
        userPromptContext = lastMsg.content;
      } else if (Array.isArray(lastMsg.content)) {
        userPromptContext = lastMsg.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text || '')
          .join(' ');
      }
    }

    // 2. Scan and extract all file blocks from the messages list
    const extractedFiles: Array<{ path: string; content: string; info: FileProcessed; role: string }> = [];
    const remainingMessages: any[] = [];
    let systemPromptMsg: any = null;

    // Pattern to match file headers/blocks and extract them
    // This allows us to separate files from the conversational flow and stabilize them
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPromptMsg = msg;
        continue;
      }

      if (typeof msg.content === 'string') {
        const detection = FileBlockDetector.detectAndPrune(msg.content, userPromptContext);
        
        if (detection.filesProcessed.length > 0) {
          // Files were found in this message. We extract them.
          // To keep the message flow intact, we replace the files in the original message with a placeholder
          // referring to the Stable Codebase Context at the beginning.
          let cleanedContent = msg.content;
          
          // Pattern A: Markdown code block preceded by file header
          const markdownPattern = /(?:(?:###\s+File:\s*|File:\s*|#\s*|(?:\r?\n|^))([a-zA-Z]:\\[^\r\n`]+|[^\r\n`]+\.[a-zA-Z0-9]+)\r?\n)```[a-zA-Z0-9\-]*\r?\n([\s\S]*?)\r?\n```/g;
          cleanedContent = cleanedContent.replace(markdownPattern, (matchStr: string, filePath: string) => {
            const trimmedPath = filePath.trim();
            return `\n[File: ${trimmedPath} is referenced in the Stable Codebase Context at the beginning of the prompt]\n`;
          });

          // Pattern B: XML tags
          const xmlPattern = /<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/g;
          cleanedContent = cleanedContent.replace(xmlPattern, (matchStr: string, filePath: string) => {
            const trimmedPath = filePath.trim();
            return `\n<file_reference path="${trimmedPath}" />\n`;
          });

          // Add the extracted files to our registry
          for (const f of detection.filesProcessed) {
            extractedFiles.push({
              path: f.filePath,
              content: f.prunedCode,
              info: f,
              role: msg.role
            });
          }

          remainingMessages.push({ ...msg, content: cleanedContent });
        } else {
          remainingMessages.push(msg);
        }
      } else {
        remainingMessages.push(msg);
      }
    }

    const filesProcessed = extractedFiles.map(e => e.info);

    // 3. Reconstruct the payload to maximize cache alignment
    const newMessages: any[] = [];

    // Step A: System Prompt (Place at index 0 and mark for caching if Anthropic)
    if (systemPromptMsg) {
      const systemMsg = { ...systemPromptMsg };
      if (isAnthropic) {
        systemMsg.cache_control = { type: 'ephemeral' };
      }
      newMessages.push(systemMsg);
    }

    // Step B: Stable Codebase Context (Sorted alphabetically)
    if (extractedFiles.length > 0) {
      // Sort files alphabetically by path to guarantee 100% prefix match across turns
      extractedFiles.sort((a, b) => a.path.localeCompare(b.path));

      // Merge files into a single unified context block
      let codebaseBlock = "=== STABLE CODEBASE CONTEXT (SKELETON & KEY METHODS) ===\n\n";
      for (const file of extractedFiles) {
        const fileExt = file.path.split('.').pop() || '';
        codebaseBlock += `File: ${file.path}\n\`\`\`${fileExt}\n${file.content}\n\`\`\`\n\n`;
      }

      // Token Alignment & Padding to nearest 1024 tokens (Anthropic boundary)
      // This prevents minor shifts in chat history from invalidating the cache block
      const currentTokenEstimate = Math.ceil(codebaseBlock.length / 4);
      const next1024Boundary = Math.ceil(currentTokenEstimate / 1024) * 1024;
      const paddingNeeded = (next1024Boundary - currentTokenEstimate) * 4;
      
      if (paddingNeeded > 0) {
        // Append benign comment block for padding alignment
        codebaseBlock += `\n/* ${' '.repeat(Math.max(0, paddingNeeded - 10))} */\n`;
      }

      const codebaseMsg: any = {
        role: 'user',
        content: codebaseBlock
      };

      if (isAnthropic) {
        // Inject the cache breakpoint at the end of the stable codebase context
        codebaseMsg.cache_control = { type: 'ephemeral' };
      }

      newMessages.push(codebaseMsg);
    }

    // Step C: Process and de-clutter past chat history to prevent KV Cache Pool Exhaustion
    const processedHistory: any[] = [];
    for (let i = 0; i < remainingMessages.length; i++) {
      const msg = remainingMessages[i];
      const isLastMessage = (i === remainingMessages.length - 1);

      if (!isLastMessage && msg.role !== 'system' && typeof msg.content === 'string') {
        // De-clutter: replace large code blocks in past history turns with placeholders
        // to prevent KV Cache Pool Exhaustion in long-running sessions
        let content = msg.content;
        
        // Pattern to match markdown code blocks
        const markdownCodeBlockPattern = /```[a-zA-Z0-9\-]*\r?\n([\s\S]*?)\r?\n```/g;
        content = content.replace(markdownCodeBlockPattern, (matchStr: string, code: string) => {
          // Only prune if the code block is substantial (e.g. > 150 characters)
          if (code.length > 150) {
            return `\n[Historical code block (~${Math.ceil(code.length / 4)} tokens) pruned by TokenCounter to prevent KV Cache Exhaustion]\n`;
          }
          return matchStr;
        });

        processedHistory.push({ ...msg, content });
      } else {
        processedHistory.push(msg);
      }
    }

    newMessages.push(...processedHistory);

    // 4. Return the optimized, cache-aligned payload
    return {
      optimizedPayload: {
        ...payload,
        messages: newMessages
      },
      filesProcessed
    };
  }
}

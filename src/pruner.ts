import * as path from 'path';

export interface PruneResult {
  prunedCode: string;
  originalTokenEstimate: number;
  prunedTokenEstimate: number;
  compressionRatio: number;
}

export class LexicalPruner {
  /**
   * Estimates token count based on a standard 4-characters-per-token heuristic.
   * This is a safe, fast fallback for local estimation.
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Evaluates whether a function/method should be kept intact (hydrated)
   * based on user query keywords. Includes smart heuristics to prevent
   * false positives from generic words like 'user' or 'get'.
   */
  private static shouldHydrate(name: string, hydrationList: string[]): boolean {
    const genericWords = new Set(['get', 'set', 'user', 'data', 'file', 'info', 'item', 'list', 'name', 'type', 'val', 'value', 'run', 'exec', 'make', 'do', 'help', 'api', 'main']);
    const lowerName = name.toLowerCase();
    
    // Split camelCase and snake_case into components
    const nameParts = lowerName.split(/[_\s]+|(?=[A-Z])/).map(p => p.toLowerCase());

    return hydrationList.some(h => {
      const lowerH = h.toLowerCase();
      
      // 1. Exact match
      if (lowerH === lowerName) return true;
      
      // 2. Component match (e.g. 'register' matches 'register_user'), excluding generic words
      if (nameParts.includes(lowerH) && !genericWords.has(lowerH)) return true;

      // 3. Simple singular/plural or basic suffix handling (e.g. 'registration' matches 'register' via 'regis' prefix)
      for (const part of nameParts) {
        if (genericWords.has(part)) continue;
        
        // Check for 5-character prefix overlap (lightweight stemmer)
        if (part.length >= 5 && lowerH.length >= 5) {
          if (part.substring(0, 5) === lowerH.substring(0, 5)) return true;
        }
        
        // Fallback to substring matching
        if (part.length > 3 && lowerH.length > 3) {
          if (part.includes(lowerH) || lowerH.includes(part)) return true;
        }
      }
      
      return false;
    });
  }

  /**
   * Prunes code in-place, keeping the file structure intact.
   */
  public static prune(filePath: string, code: string, hydrationList: string[]): PruneResult {
    const ext = path.extname(filePath).toLowerCase();
    const originalTokens = this.estimateTokens(code);
    let prunedCode = code;

    try {
      if (ext === '.py') {
        prunedCode = this.prunePython(code, hydrationList);
      } else if (['.ts', '.js', '.tsx', '.jsx', '.json', '.java', '.cpp', '.c', '.cs'].includes(ext)) {
        prunedCode = this.pruneBraceStyle(code, hydrationList, ext);
      }
    } catch (err) {
      // In case of any parsing error, fallback to original code to ensure zero-bug robustness
      prunedCode = code;
    }

    const prunedTokens = this.estimateTokens(prunedCode);
    const compressionRatio = originalTokens > 0 ? (originalTokens - prunedTokens) / originalTokens : 0;

    return {
      prunedCode,
      originalTokenEstimate: originalTokens,
      prunedTokenEstimate: prunedTokens,
      compressionRatio
    };
  }

  /**
   * Indent-based pruner for Python.
   * Preserves function signatures and stubs the body with 'pass'.
   */
  private static prunePython(code: string, hydrationList: string[]): string {
    const lines = code.split(/\r?\n/);
    const resultLines: string[] = [];
    
    // Matches 'def function_name(...):' or class methods
    const pythonDefRegex = /^(\s*)def\s+(\w+)\s*\(.*?\)\s*(?:->\s*[^:]+)?\s*:/;

    let isPruning = false;
    let pruneIndentLevel = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines or comments while pruning
      if (isPruning) {
        if (trimmed === '' || trimmed.startsWith('#')) {
          continue;
        }

        // Calculate indentation level of the current line
        const indentMatch = line.match(/^(\s*)/);
        const indentLevel = indentMatch ? indentMatch[1].length : 0;

        if (indentLevel <= pruneIndentLevel) {
          // We have exited the function body scope
          isPruning = false;
          pruneIndentLevel = -1;
        } else {
          // Skip the body line
          continue;
        }
      }

      // Check for new function declaration
      const match = line.match(pythonDefRegex);
      if (match) {
        const indent = match[1];
        const name = match[2];

        const shouldHydrate = this.shouldHydrate(name, hydrationList);

        if (!shouldHydrate) {
          isPruning = true;
          pruneIndentLevel = indent.length;
          
          // Push signature line
          resultLines.push(line);
          // Push valid indented stub
          const bodyIndent = indent + '    ';
          resultLines.push(`${bodyIndent}pass  # ... [TokenCounter: ${name}() body hidden] ...`);
          continue;
        }
      }

      resultLines.push(line);
    }

    return resultLines.join('\n');
  }

  /**
   * Robust brace-counting parser for JS/TS/Java/C++ style languages.
   * Preserves signatures and class structure, stubs non-targeted bodies in-place.
   */
  private static pruneBraceStyle(code: string, hydrationList: string[], ext: string): string {
    const lines = code.split(/\r?\n/);
    const resultLines: string[] = [];

    // Match function/method declarations, e.g., 'function name(', 'name(args) {', 'async name('
    // Avoid matching control structures like 'if', 'for', 'while', 'switch', 'catch'
    const functionRegex = /(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*\{)/;
    const reservedWords = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'constructor']);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip json files or simple configuration blocks
      if (ext === '.json') {
        resultLines.push(line);
        i++;
        continue;
      }

      const match = line.match(functionRegex);
      if (match) {
        const name = match[1] || match[2];
        
        if (name && !reservedWords.has(name)) {
          const shouldHydrate = this.shouldHydrate(name, hydrationList);

          if (!shouldHydrate) {
            // Find the opening brace '{'
            let openBraceIndex = line.indexOf('{');
            let braceLineIndex = i;

            // Scan forward if the opening brace is on a subsequent line
            while (openBraceIndex === -1 && braceLineIndex < lines.length - 1) {
              braceLineIndex++;
              openBraceIndex = lines[braceLineIndex].indexOf('{');
            }

            if (openBraceIndex !== -1) {
              // Push all signature lines up to the opening brace
              for (let j = i; j <= braceLineIndex; j++) {
                if (j === braceLineIndex) {
                  const partBeforeBrace = lines[j].substring(0, openBraceIndex + 1);
                  resultLines.push(partBeforeBrace);
                } else {
                  resultLines.push(lines[j]);
                }
              }

              // Push the in-place placeholder comment
              const sigIndentMatch = lines[i].match(/^(\s*)/);
              const sigIndent = sigIndentMatch ? sigIndentMatch[1] : '';
              const bodyIndent = sigIndent + '    ';
              resultLines.push(`${bodyIndent}// ... [TokenCounter: ${name}() body hidden] ...`);

              // Brace counting algorithm to skip the body
              let braceCount = 1;
              let charIndex = openBraceIndex + 1;
              let currentLineIndex = braceLineIndex;

              while (currentLineIndex < lines.length && braceCount > 0) {
                const curLine = lines[currentLineIndex];
                
                while (charIndex < curLine.length && braceCount > 0) {
                  const char = curLine[charIndex];
                  if (char === '{') {
                    braceCount++;
                  } else if (char === '}') {
                    braceCount--;
                  }
                  charIndex++;
                }

                if (braceCount > 0) {
                  currentLineIndex++;
                  charIndex = 0;
                }
              }

              // Handle the closing brace line
              if (currentLineIndex < lines.length) {
                const remainingLine = lines[currentLineIndex].substring(charIndex);
                if (remainingLine.trim() !== '') {
                  // If there is code remaining on the closing brace line (e.g. '} else {'), keep it
                  // But indent it nicely
                  resultLines.push(`${sigIndent}}${remainingLine}`);
                } else {
                  resultLines.push(`${sigIndent}}`);
                }
                // Update outer loop index to resume after the function body
                i = currentLineIndex + 1;
                continue;
              }
            }
          }
        }
      }

      resultLines.push(line);
      i++;
    }

    return resultLines.join('\n');
  }
}

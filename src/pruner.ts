import * as path from 'path';
import * as fs from 'fs';
import Parser from 'web-tree-sitter';

export interface PruneResult {
  prunedCode: string;
  originalTokenEstimate: number;
  prunedTokenEstimate: number;
  compressionRatio: number;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

// Maps file extensions to their respective tree-sitter wasm filenames
const LANGUAGE_WASM_MAP: { [ext: string]: string } = {
  '.js': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.py': 'tree-sitter-python.wasm',
  '.pyw': 'tree-sitter-python.wasm',
  '.c': 'tree-sitter-c.wasm',
  '.cpp': 'tree-sitter-cpp.wasm',
  '.cc': 'tree-sitter-cpp.wasm',
  '.cxx': 'tree-sitter-cpp.wasm',
  '.h': 'tree-sitter-c.wasm',
  '.hpp': 'tree-sitter-cpp.wasm',
  '.java': 'tree-sitter-java.wasm',
  '.cs': 'tree-sitter-c_sharp.wasm',
  '.go': 'tree-sitter-go.wasm',
};

// Cache for loaded language grammars to ensure high performance
const languageCache = new Map<string, Parser.Language>();
let isInitialized = false;

// Locates a wasm grammar file dynamically across packaged/development environments
function getWasmPath(wasmName: string): string {
  const pathsToTry = [
    path.join(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out', wasmName),
    path.join(__dirname, 'node_modules', 'tree-sitter-wasms', 'out', wasmName),
    path.join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out', wasmName),
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  throw new Error(`Could not locate WASM grammar file: ${wasmName}`);
}

// Guarantees web-tree-sitter is properly initialized with correct core WASM path
async function ensureInitialized() {
  if (!isInitialized) {
    const coreWasmPaths = [
      path.join(__dirname, '..', 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
      path.join(__dirname, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
      path.join(process.cwd(), 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
    ];
    
    let coreWasmPath = '';
    for (const p of coreWasmPaths) {
      if (fs.existsSync(p)) {
        coreWasmPath = p;
        break;
      }
    }

    if (coreWasmPath) {
      await Parser.init({
        locateFile(scriptName: string) {
          if (scriptName === 'web-tree-sitter.wasm') {
            return coreWasmPath;
          }
          return scriptName;
        }
      });
    } else {
      await Parser.init();
    }
    isInitialized = true;
  }
}

// Retrieves and caches the requested tree-sitter language
async function getLanguage(ext: string): Promise<Parser.Language | null> {
  const wasmName = LANGUAGE_WASM_MAP[ext];
  if (!wasmName) return null;

  if (languageCache.has(wasmName)) {
    return languageCache.get(wasmName)!;
  }

  try {
    const wasmPath = getWasmPath(wasmName);
    const lang = await Parser.Language.load(wasmPath);
    languageCache.set(wasmName, lang);
    return lang;
  } catch (err) {
    console.error(`[ASTPruner] Failed to load tree-sitter language for ${ext}:`, err);
    return null;
  }
}

// Helper to determine the leading indentation of a line
function getLineIndent(code: string, index: number): string {
  let start = index;
  while (start > 0 && code[start - 1] !== '\n' && code[start - 1] !== '\r') {
    start--;
  }
  const linePart = code.substring(start, index);
  const match = linePart.match(/^(\s*)/);
  return match ? match[1] : '';
}

export class ASTPruner {
  /**
   * Estimates token count based on a standard 4-characters-per-token heuristic.
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Evaluates whether a function/method should be kept intact (hydrated)
   * based on user query keywords.
   */
  private static shouldHydrate(name: string, hydrationList: string[]): boolean {
    const genericWords = new Set(['get', 'set', 'user', 'data', 'file', 'info', 'item', 'list', 'name', 'type', 'val', 'value', 'run', 'exec', 'make', 'do', 'help', 'api', 'main', 'handle']);
    const nameParts = name.split(/[_\s]+|(?=[A-Z])/).map(p => p.toLowerCase());
    const lowerName = name.toLowerCase();

    return hydrationList.some(h => {
      const lowerH = h.toLowerCase();
      if (lowerH === lowerName) return true;
      if (nameParts.includes(lowerH) && !genericWords.has(lowerH)) return true;

      for (const part of nameParts) {
        if (genericWords.has(part)) continue;
        if (part.length >= 5 && lowerH.length >= 5) {
          if (part.substring(0, 5) === lowerH.substring(0, 5)) return true;
        }
        if (part.length > 3 && lowerH.length > 3) {
          if (part.includes(lowerH) || lowerH.includes(part)) return true;
        }
      }
      return false;
    });
  }

  /**
   * AST-based structural code pruner using web-tree-sitter.
   * Preserves signatures and stubs non-targeted bodies dynamically.
   */
  public static async prune(filePath: string, code: string, hydrationList: string[]): Promise<PruneResult> {
    const ext = path.extname(filePath).toLowerCase();
    const originalTokens = this.estimateTokens(code);
    let prunedCode = code;

    try {
      await ensureInitialized();
      const lang = await getLanguage(ext);
      
      if (lang) {
        const parser = new Parser();
        parser.setLanguage(lang);
        const tree = parser.parse(code);
        
        const replacements: Replacement[] = [];
        const isPython = (ext === '.py' || ext === '.pyw');
        
        this.collectReplacements(tree.rootNode, hydrationList, replacements, code, isPython);
        
        if (replacements.length > 0) {
          // Sort replacements in descending order of start index to apply them back-to-front
          replacements.sort((a, b) => b.start - a.start);
          
          let codeBuffer = code;
          for (const rep of replacements) {
            codeBuffer = codeBuffer.substring(0, rep.start) + rep.text + codeBuffer.substring(rep.end);
          }
          prunedCode = codeBuffer;
        }
      }
    } catch (err) {
      console.error(`[ASTPruner] Error pruning ${filePath}:`, err);
      // Fail-safe fallback to original code
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
   * Recursively traverses AST to identify and collect pruneable functions/methods
   */
  private static collectReplacements(
    node: Parser.SyntaxNode,
    hydrationList: string[],
    replacements: Replacement[],
    code: string,
    isPython: boolean
  ) {
    let isFunc = false;
    let name = '';
    let bodyNode: Parser.SyntaxNode | null = null;

    if (isPython) {
      if (node.type === 'function_definition') {
        isFunc = true;
        const nameNode = node.childForFieldName('name');
        name = nameNode ? nameNode.text : '';
        bodyNode = node.childForFieldName('body');
      }
    } else {
      // JS/TS/C++/Java/C# style
      if (node.type === 'function_declaration' || node.type === 'method_definition' || node.type === 'generator_function_declaration') {
        isFunc = true;
        const nameNode = node.childForFieldName('name');
        name = nameNode ? nameNode.text : '';
        bodyNode = node.childForFieldName('body');
      } else if (node.type === 'arrow_function' || node.type === 'function_expression') {
        isFunc = true;
        bodyNode = node.childForFieldName('body');
        if (node.parent && node.parent.type === 'variable_declarator') {
          for (let i = 0; i < node.parent.childCount; i++) {
            const child = node.parent.child(i);
            if (child && child.type === 'identifier') {
              name = child.text;
              break;
            }
          }
        }
      }
    }

    if (isFunc && bodyNode) {
      const keep = name ? this.shouldHydrate(name, hydrationList) : true;
      if (!keep) {
        let replacementText = '';
        if (isPython) {
          const indent = getLineIndent(code, node.startIndex);
          const currentIndent = indent || '';
          replacementText = `\n${currentIndent}    pass  # ... [TokenCounter: ${name}() body hidden] ...`;
          replacements.push({
            start: bodyNode.startIndex,
            end: bodyNode.endIndex,
            text: replacementText
          });
        } else {
          replacementText = `{ /* ... [TokenCounter: ${name || 'anonymous'}() body hidden] ... */ }`;
          replacements.push({
            start: bodyNode.startIndex,
            end: bodyNode.endIndex,
            text: replacementText
          });
        }
        // Do not traverse children of pruned node
        return;
      }
    }

    // Traverse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.collectReplacements(child, hydrationList, replacements, code, isPython);
      }
    }
  }
}

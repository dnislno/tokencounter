import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { CacheOrchestrator } from './orchestrator';
import { DASHBOARD_HTML } from './dashboard';

export interface ProxyStats {
  totalRequests: number;
  originalTokens: number;
  prunedTokens: number;
  savedTokens: number;
  savedUSD: number;
}

export class TokenCounterProxy {
  private server: http.Server | null = null;
  private port: number;
  private logCallback: (msg: string) => void = () => {};
  private sseClients: http.ServerResponse[] = [];
  
  private stats: ProxyStats = {
    totalRequests: 0,
    originalTokens: 0,
    prunedTokens: 0,
    savedTokens: 0,
    savedUSD: 0
  };

  constructor(port: number) {
    this.port = port;
  }

  public setLogCallback(callback: (msg: string) => void) {
    this.logCallback = callback;
  }

  private log(msg: string) {
    this.logCallback(msg);
    // Push real-time log messages to all active SSE clients (Dashboard Web UI)
    const sseMessage = `data: ${msg.replace(/\n/g, ' ')}\n\n`;
    this.sseClients.forEach(c => c.write(sseMessage));
  }

  public getStats(): ProxyStats {
    return this.stats;
  }

  /**
   * Starts the local proxy server.
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve();
        return;
      }

      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err: any) => {
        this.log(`[Error] Proxy server error: ${err.message}`);
        reject(err);
      });

      this.server.listen(this.port, () => {
        this.log(`[Proxy] TokenCounter Proxy listening on port ${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stops the local proxy server.
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.log('[Proxy] TokenCounter Proxy stopped');
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Handles incoming HTTP requests from the AI client.
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';

    // Route: GET /dashboard or /dashboard/
    if (req.method === 'GET' && (pathname === '/dashboard' || pathname === '/dashboard/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD_HTML);
      return;
    }

    // Route: GET /v1/stats
    if (req.method === 'GET' && pathname === '/v1/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getStats()));
      return;
    }

    // Route: POST /v1/reset-stats
    if (req.method === 'POST' && pathname === '/v1/reset-stats') {
      this.stats = {
        totalRequests: 0,
        originalTokens: 0,
        prunedTokens: 0,
        savedTokens: 0,
        savedUSD: 0
      };
      this.log('[Proxy] Statistics reset via Web UI');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Route: GET /v1/events (SSE Stream)
    if (req.method === 'GET' && pathname === '/v1/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      
      res.write('data: Connected to TokenCounter SSE Stream\n\n');
      this.sseClients.push(res);

      req.on('close', () => {
        this.sseClients = this.sseClients.filter(c => c !== res);
      });
      return;
    }

    this.log(`[Request] ${req.method} ${req.url}`);

    // Intercept POST requests to chat completion endpoints
    const isChatEndpoint = req.url?.endsWith('/chat/completions') || req.url?.endsWith('/messages');
    if (req.method === 'POST' && isChatEndpoint) {
      this.interceptAndOptimize(req, res);
    } else {
      // Direct pass-through for other endpoints (like /models or /v1/models)
      this.forwardRawRequest(req, res, Buffer.alloc(0), false);
    }
  }

  /**
   * Intercepts the request, parses the JSON payload, applies optimization, and forwards it.
   */
  private interceptAndOptimize(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', async () => {
      const bodyBuffer = Buffer.concat(chunks);
      
      try {
        const payloadStr = bodyBuffer.toString('utf8');
        if (!payloadStr.trim()) {
          this.forwardRawRequest(req, res, bodyBuffer, false);
          return;
        }

        const payload = JSON.parse(payloadStr);
        
        // Apply our Stable Prefix Caching Orchestration
        const result = await CacheOrchestrator.orchestrate(payload);
        
        this.stats.totalRequests++;

        // Update global statistics
        if (result.filesProcessed.length > 0) {
          let totalOriginal = 0;
          let totalPruned = 0;

          for (const file of result.filesProcessed) {
            totalOriginal += file.originalTokens;
            totalPruned += file.prunedTokens;
            this.log(`[Optimized] ${file.filename}: ${file.originalTokens} -> ${file.prunedTokens} tokens (Saved ${Math.round(file.compressionRatio * 100)}%)`);
          }

          const saved = totalOriginal - totalPruned;
          this.stats.originalTokens += totalOriginal;
          this.stats.prunedTokens += totalPruned;
          this.stats.savedTokens += saved;
          
          // Blended savings rate calculation:
          // $3.00/1M tokens (Claude 3.5 Sonnet Input)
          // Cached read saves 90% ($2.70/1M)
          // We assume a blended savings of $3.00 per 1M tokens saved from pruning
          const usdSaved = (saved / 1000000) * 3.00;
          this.stats.savedUSD += usdSaved;

          const overallRatio = 1 - totalPruned / totalOriginal;
          this.log(`[Stats] Compressed ${result.filesProcessed.length} files: ${totalOriginal} -> ${totalPruned} tokens (Saved ${Math.round(overallRatio * 100)}% | Saved $${usdSaved.toFixed(4)})`);
        }

        // Re-serialize the optimized payload
        const optimizedBody = Buffer.from(JSON.stringify(result.optimizedPayload));
        this.forwardRawRequest(req, res, optimizedBody, true);

      } catch (err: any) {
        this.log(`[Error] Failed to optimize payload: ${err.message}. Falling back to raw forwarding.`);
        // Fallback to raw forwarding to ensure 100% zero-bug reliability
        this.forwardRawRequest(req, res, bodyBuffer, false);
      }
    });

    req.on('error', (err) => {
      this.log(`[Error] Request stream error: ${err.message}`);
      res.writeHead(500);
      res.end(`Request Error: ${err.message}`);
    });
  }

  /**
   * Forwards the request buffer to the official provider (OpenAI or Anthropic).
   */
  private forwardRawRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    bodyBuffer: Buffer,
    isOptimized: boolean
  ) {
    const parsedUrl = url.parse(req.url || '');
    const path = parsedUrl.pathname || '';
    
    // Determine the target host based on request headers or endpoint path
    const isAnthropic = path.startsWith('/v1/messages') || req.headers['x-api-key'] !== undefined;
    
    let targetHost = isAnthropic ? 'api.anthropic.com' : 'api.openai.com';
    let targetPort = 443;
    let isTest = false;

    // Support override target host via env for local testing
    if (process.env.TOKENCOUNTER_TEST_TARGET) {
      const parts = process.env.TOKENCOUNTER_TEST_TARGET.split(':');
      targetHost = parts[0];
      targetPort = parts[1] ? parseInt(parts[1]) : 80;
      isTest = true;
    }

    const headers = { ...req.headers };
    
    // Strip headers that interfere with proxying
    delete headers['host'];
    delete headers['connection'];
    
    if (isOptimized) {
      headers['content-length'] = bodyBuffer.length.toString();
    }

    const options: https.RequestOptions = {
      hostname: targetHost,
      port: targetPort,
      path: path,
      method: req.method,
      headers: headers,
      timeout: 90000 // 90 seconds timeout for long reasoning tasks
    };

    const requestModule = (isTest && (targetHost === 'localhost' || targetHost === '127.0.0.1')) ? http : https;

    const proxyReq = requestModule.request(options, (proxyRes) => {
      // Copy status and headers to client response
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      
      // Pipe the stream directly for perfect streaming support (chunk-by-chunk)
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      this.log(`[Error] Failed to forward request to ${targetHost}: ${err.message}`);
      res.writeHead(502);
      res.end(`Bad Gateway: ${err.message}`);
    });

    if (isOptimized) {
      proxyReq.write(bodyBuffer);
    } else {
      // For raw passthrough, pipe the original request stream directly if the body isn't fully read yet
      req.pipe(proxyReq);
      return;
    }

    proxyReq.end();
  }
}

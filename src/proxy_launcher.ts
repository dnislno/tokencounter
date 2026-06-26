import { TokenCounterProxy } from './proxy';

const port = process.env.PORT ? parseInt(process.env.PORT) : 9099;
const proxy = new TokenCounterProxy(port);

proxy.setLogCallback((msg) => {
  console.log(msg);
});

proxy.start().then(() => {
  console.log(`====================================================`);
  console.log(`  TokenCounter Standalone Reverse Proxy Started     `);
  console.log(`====================================================`);
  console.log(`Proxy Base URL : http://localhost:${port}/v1`);
  console.log(`Web Dashboard  : http://localhost:${port}/dashboard`);
  console.log(`====================================================`);
}).catch((err) => {
  console.error(`[Fatal] Failed to start proxy:`, err);
  process.exit(1);
});

// Handle graceful shutdown
const shutdown = () => {
  proxy.stop().then(() => {
    console.log('[Proxy] Stopped gracefully');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

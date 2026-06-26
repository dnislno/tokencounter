import * as vscode from 'vscode';
import { TokenCounterProxy } from './proxy';

let proxyInstance: TokenCounterProxy | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let outputChannel: vscode.OutputChannel | null = null;

export async function activate(context: vscode.ExtensionContext) {
  // 1. Create Output Channel for logs
  outputChannel = vscode.window.createOutputChannel('TokenCounter');
  context.subscriptions.push(outputChannel);
  log('TokenCounter & CacheOrchestrator extension activated.');

  // 2. Load configuration
  const config = vscode.workspace.getConfiguration('tokencounter');
  const port = config.get<number>('proxyPort', 9099);
  const autoStart = config.get<boolean>('autoStart', true);

  // 3. Initialize Proxy
  proxyInstance = new TokenCounterProxy(port);
  proxyInstance.setLogCallback((msg) => log(msg));

  // 4. Create Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(statusBarItem);
  updateStatusBar(false);
  statusBarItem.show();

  // 5. Register Commands
  const startCommand = vscode.commands.registerCommand('tokencounter.startProxy', async () => {
    await startProxyServer();
  });

  const stopCommand = vscode.commands.registerCommand('tokencounter.stopProxy', async () => {
    await stopProxyServer();
  });

  const statsCommand = vscode.commands.registerCommand('tokencounter.viewStats', () => {
    showStats();
  });

  context.subscriptions.push(startCommand, stopCommand, statsCommand);

  // 6. Auto-start if configured
  if (autoStart) {
    await startProxyServer();
  }
}

export async function deactivate() {
  await stopProxyServer();
}

function log(msg: string) {
  if (outputChannel) {
    outputChannel.appendLine(msg);
  }
}

async function startProxyServer() {
  if (!proxyInstance) return;

  const port = vscode.workspace.getConfiguration('tokencounter').get<number>('proxyPort', 9099);
  
  try {
    await proxyInstance.start();
    updateStatusBar(true);
    vscode.window.showInformationMessage(`TokenCounter Proxy started on port ${port}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to start TokenCounter Proxy: ${error.message}`);
    updateStatusBar(false);
  }
}

async function stopProxyServer() {
  if (!proxyInstance) return;

  try {
    await proxyInstance.stop();
    updateStatusBar(false);
    vscode.window.showInformationMessage('TokenCounter Proxy stopped.');
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to stop TokenCounter Proxy: ${error.message}`);
  }
}

function showStats() {
  if (!proxyInstance) return;

  const stats = proxyInstance.getStats();
  const savedPercent = stats.originalTokens > 0 ? Math.round((stats.savedTokens / stats.originalTokens) * 100) : 0;
  
  const msg = `[TokenCounter Stats]\n` +
              `• Total Requests: ${stats.totalRequests}\n` +
              `• Original Context: ${stats.originalTokens.toLocaleString()} tokens\n` +
              `• Pruned/Sent: ${stats.prunedTokens.toLocaleString()} tokens\n` +
              `• Net Saved: ${stats.savedTokens.toLocaleString()} tokens (${savedPercent}% saved)\n` +
              `• Estimated Financial Savings: $${stats.savedUSD.toFixed(4)}`;
  
  vscode.window.showInformationMessage(msg, { modal: true }, 'Reset Stats').then((selection) => {
    if (selection === 'Reset Stats') {
      stats.totalRequests = 0;
      stats.originalTokens = 0;
      stats.prunedTokens = 0;
      stats.savedTokens = 0;
      stats.savedUSD = 0;
      updateStatusBar(true);
      vscode.window.showInformationMessage('TokenCounter statistics reset.');
    }
  });
}

function updateStatusBar(isActive: boolean) {
  if (!statusBarItem || !proxyInstance) return;

  const stats = proxyInstance.getStats();
  
  if (isActive) {
    statusBarItem.text = `$(zap) TokenCounter: $${stats.savedUSD.toFixed(2)}`;
    statusBarItem.tooltip = `TokenCounter Proxy is ACTIVE.\nTotal Saved: $${stats.savedUSD.toFixed(4)} (${stats.savedTokens.toLocaleString()} tokens)\nClick to view controls and statistics.`;
    statusBarItem.command = 'tokencounter.viewStats';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = `$(mute) TokenCounter: Off`;
    statusBarItem.tooltip = 'TokenCounter Proxy is INACTIVE. Click to start.';
    statusBarItem.command = 'tokencounter.startProxy';
    statusBarItem.backgroundColor = undefined;
  }
}

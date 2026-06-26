export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TokenCounter Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0a0a0c;
            --card-bg: rgba(18, 18, 22, 0.7);
            --card-border: rgba(255, 255, 255, 0.05);
            --accent-gradient: linear-gradient(135deg, #ff5e36 0%, #ffa226 100%);
            --accent-color: #ff5e36;
            --text-main: #f3f3f6;
            --text-muted: #8e8e9f;
            --success-color: #10b981;
            --glow-shadow: 0 0 20px rgba(255, 94, 54, 0.15);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            min-height: 100vh;
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 10% 20%, rgba(255, 94, 54, 0.05) 0%, transparent 40%),
                radial-gradient(circle at 90% 80%, rgba(255, 162, 38, 0.05) 0%, transparent 40%);
            padding-bottom: 50px;
        }

        header {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px 20px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--card-border);
        }

        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .logo-icon {
            width: 38px;
            height: 38px;
            background: var(--accent-gradient);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-family: 'Space Grotesk', sans-serif;
            color: #000;
            box-shadow: var(--glow-shadow);
        }

        .logo-text {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.5px;
        }

        .logo-text span {
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .status-badge {
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            color: var(--success-color);
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            background-color: var(--success-color);
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        main {
            max-width: 1200px;
            margin: 30px auto 0 auto;
            padding: 0 20px;
        }

        .grid-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 24px;
            backdrop-filter: blur(10px);
            position: relative;
            overflow: hidden;
            transition: transform 0.3s ease, border-color 0.3s ease;
        }

        .card:hover {
            transform: translateY(-4px);
            border-color: rgba(255, 94, 54, 0.2);
        }

        .card-label {
            color: var(--text-muted);
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }

        .card-value {
            font-size: 32px;
            font-weight: 800;
            font-family: 'Space Grotesk', sans-serif;
            background: var(--text-main);
            -webkit-background-clip: text;
            margin-bottom: 4px;
        }

        .card-value.highlight {
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .card-subtext {
            font-size: 13px;
            color: var(--text-muted);
        }

        .grid-details {
            display: grid;
            grid-template-columns: 1.5fr 1fr;
            gap: 20px;
        }

        @media (max-width: 900px) {
            .grid-details {
                grid-template-columns: 1fr;
            }
        }

        .section-title {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .btn {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 8px 16px;
            border-radius: 8px;
            font-family: 'Outfit', sans-serif;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .btn:hover {
            background: rgba(255, 94, 54, 0.1);
            border-color: rgba(255, 94, 54, 0.3);
            color: var(--accent-color);
        }

        .console-container {
            background: #060608;
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 20px;
            font-family: 'Courier New', Courier, monospace;
            height: 350px;
            display: flex;
            flex-direction: column;
        }

        .console-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .dot-red { background-color: #ef4444; }
        .dot-yellow { background-color: #f59e0b; }
        .dot-green { background-color: #10b981; }

        .console-title {
            font-size: 12px;
            color: var(--text-muted);
            margin-left: 6px;
            font-weight: bold;
        }

        .console-log {
            flex-grow: 1;
            overflow-y: auto;
            font-size: 13px;
            line-height: 1.5;
            color: #a7f3d0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .log-time {
            color: #6b7280;
            margin-right: 8px;
        }

        .chart-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 350px;
        }

        .circle-chart {
            position: relative;
            width: 200px;
            height: 200px;
        }

        .circle-chart svg {
            transform: rotate(-90deg);
            width: 100%;
            height: 100%;
        }

        .circle-bg {
            fill: none;
            stroke: rgba(255,255,255,0.03);
            stroke-width: 16;
        }

        .circle-progress {
            fill: none;
            stroke: url(#gradient);
            stroke-width: 16;
            stroke-linecap: round;
            stroke-dasharray: 565.48; /* 2 * PI * 90 */
            stroke-dashoffset: 565.48;
            transition: stroke-dashoffset 1s ease;
        }

        .circle-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
        }

        .percentage {
            font-size: 40px;
            font-weight: 800;
            font-family: 'Space Grotesk', sans-serif;
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .percentage-label {
            font-size: 12px;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
        }
    </style>
</head>
<body>
    <header>
        <div class="logo-container">
            <div class="logo-icon">T</div>
            <div class="logo-text">Token<span>Counter</span></div>
        </div>
        <div class="status-badge">
            <div class="status-dot"></div>
            <span>PROXY ACTIVE</span>
        </div>
    </header>

    <main>
        <div class="grid-stats">
            <div class="card">
                <div class="card-label">Total Requests</div>
                <div id="stat-requests" class="card-value">0</div>
                <div class="card-subtext">Optimized in-flight calls</div>
            </div>
            <div class="card">
                <div class="card-label">Original Tokens</div>
                <div id="stat-original" class="card-value">0</div>
                <div class="card-subtext">Without context compression</div>
            </div>
            <div class="card">
                <div class="card-label">Tokens Saved</div>
                <div id="stat-saved-tokens" class="card-value highlight">0</div>
                <div id="stat-ratio" class="card-subtext">0% compression ratio</div>
            </div>
            <div class="card">
                <div class="card-label">Estimated Savings</div>
                <div id="stat-saved-usd" class="card-value highlight">$0.0000</div>
                <div class="card-subtext">Based on $3.00/1M rate</div>
            </div>
        </div>

        <div class="grid-details">
            <div class="card">
                <div class="section-title">
                    <span>Real-Time Optimization Log</span>
                    <button id="btn-reset" class="btn">Reset Statistics</button>
                </div>
                <div class="console-container">
                    <div class="console-header">
                        <div class="dot dot-red"></div>
                        <div class="dot dot-yellow"></div>
                        <div class="dot dot-green"></div>
                        <div class="console-title">proxy_server_stdout</div>
                    </div>
                    <div id="log-terminal" class="console-log">
                        <div><span class="log-time">[18:00:00]</span> TokenCounter local reverse proxy initialized.</div>
                        <div><span class="log-time">[18:00:01]</span> Registered endpoints: /v1/chat/completions, /v1/messages, /dashboard.</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="section-title">Compression Efficiency</div>
                <div class="chart-container">
                    <div class="circle-chart">
                        <svg>
                            <defs>
                                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stop-color="#ff5e36" />
                                    <stop offset="100%" stop-color="#ffa226" />
                                </linearGradient>
                            </defs>
                            <circle class="circle-bg" cx="100" cy="100" r="90"></circle>
                            <circle id="progress-ring" class="circle-progress" cx="100" cy="100" r="90"></circle>
                        </svg>
                        <div class="circle-text">
                            <div id="chart-percentage" class="percentage">0%</div>
                            <div class="percentage-label">Saved</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <script>
        const API_BASE = window.location.origin;
        const logTerminal = document.getElementById('log-terminal');
        const progressRing = document.getElementById('progress-ring');
        const chartPercentage = document.getElementById('chart-percentage');

        // Circle Circumference = 2 * PI * 90 = 565.48
        const CIRCUMFERENCE = 565.48;

        function setProgress(percent) {
            const offset = CIRCUMFERENCE - (percent / 100 * CIRCUMFERENCE);
            progressRing.style.strokeDashoffset = offset;
            chartPercentage.innerText = Math.round(percent) + '%';
        }

        function addLog(message) {
            const div = document.createElement('div');
            const time = new Date().toLocaleTimeString();
            div.innerHTML = \`<span class="log-time">[\${time}]</span> \${message}\`;
            logTerminal.appendChild(div);
            
            // Auto scroll to bottom
            logTerminal.scrollTop = logTerminal.scrollHeight;
            
            // Limit log lines
            while (logTerminal.children.length > 30) {
                logTerminal.removeChild(logTerminal.firstChild);
            }
        }

        async function fetchStats() {
            try {
                const res = await fetch(\`\${API_BASE}/v1/stats\`);
                if (!res.ok) return;
                
                const stats = await res.json();
                
                document.getElementById('stat-requests').innerText = stats.totalRequests.toLocaleString();
                document.getElementById('stat-original').innerText = stats.originalTokens.toLocaleString();
                document.getElementById('stat-saved-tokens').innerText = stats.savedTokens.toLocaleString();
                document.getElementById('stat-saved-usd').innerText = '$' + stats.savedUSD.toFixed(4);

                const ratio = stats.originalTokens > 0 ? (stats.savedTokens / stats.originalTokens) * 100 : 0;
                document.getElementById('stat-ratio').innerText = Math.round(ratio) + '% compression ratio';
                
                setProgress(ratio);
            } catch (err) {
                console.error("Failed to fetch stats:", err);
            }
        }

        // Handle stats reset
        document.getElementById('btn-reset').addEventListener('click', async () => {
            if (confirm("Are you sure you want to reset all statistics?")) {
                try {
                    const res = await fetch(\`\${API_BASE}/v1/reset-stats\`, { method: 'POST' });
                    if (res.ok) {
                        addLog("Proxy statistics reset successfully.");
                        fetchStats();
                    }
                } catch (err) {
                    addLog("Failed to reset statistics: " + err.message);
                }
            }
        });

        // Setup polling
        setInterval(fetchStats, 2000);
        fetchStats();

        // Establish SSE (Server-Sent Events) for real-time logs if available, 
        // fallback to polling mock events or actual local updates
        const evtSource = new EventSource(\`\${API_BASE}/v1/events\`);
        evtSource.onmessage = function(event) {
            addLog(event.data);
            fetchStats();
        };
        
        evtSource.onerror = function() {
            // Silence error, SSE is a progressive enhancement
        };
    </script>
</body>
</html>
`;

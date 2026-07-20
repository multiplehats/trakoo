import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Import from the built library (two levels up from e2e/test-app)
const distPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../dist"
);

const { createServerAnalytics } = await import(`${distPath}/server.js`);
const { PirschServerProvider, ingestProxyEvents } = await import(
  `${distPath}/providers/server.js`
);

const app = express();
app.use(express.json());

// Track the result of the last Pirsch API call for test inspection
let lastCallStatus = { success: null, error: null, calls: [] };

// Override fetch to intercept Pirsch API calls
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === "string" && url.includes("api.pirsch.io")) {
    const start = Date.now();
    try {
      const response = await originalFetch(url, options);
      const duration = Date.now() - start;
      lastCallStatus.calls.push({
        url,
        status: response.status,
        duration,
        success: response.ok,
        timestamp: new Date().toISOString(),
      });
      if (response.ok) {
        lastCallStatus.success = true;
        lastCallStatus.error = null;
      } else {
        lastCallStatus.success = false;
        lastCallStatus.error = `HTTP ${response.status}`;
      }
      return response;
    } catch (err) {
      const duration = Date.now() - start;
      lastCallStatus.calls.push({
        url,
        error: err.message,
        duration,
        success: false,
        timestamp: new Date().toISOString(),
      });
      lastCallStatus.success = false;
      lastCallStatus.error = err.message;
      throw err;
    }
  }
  return originalFetch(url, options);
};

// Set up Pirsch server analytics
const pirschProvider = new PirschServerProvider({
  hostname: "test.stacksee.com",
  clientId: process.env.PIRSCH_CLIENT_ID || "cOpxstLX4vBg4BNkHGJPCMXC8mcxH6lH",
  clientSecret:
    process.env.PIRSCH_CLIENT_SECRET ||
    "3BUsxDKJrv0MmQvVCFoCIh9QCBdEKmtPvaXCnWCc2NjUsCI1kRvfM2f1Kq5YdRmK",
  timeout: 15000, // Increased from default 10s to avoid Vercel-style timeouts
  debug: true,
  disableBotFilter: true, // Allow test traffic through
});

const serverAnalytics = createServerAnalytics({
  providers: [pirschProvider],
  debug: true,
  enabled: true,
});

// POST /api/analytics — proxy endpoint that ingests client events
app.post("/api/analytics", async (req, res) => {
  try {
    // Convert express request to Web API Request for ingestProxyEvents
    const url = `http://localhost:${PORT}${req.path}`;
    const webRequest = new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": req.headers["user-agent"] || "test-browser",
        "x-forwarded-for": req.headers["x-forwarded-for"] || "127.0.0.1",
        "x-real-ip": req.headers["x-real-ip"] || "127.0.0.1",
      },
      body: JSON.stringify(req.body),
    });

    await ingestProxyEvents(webRequest, serverAnalytics);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[Test Server] Error ingesting events:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/analytics/status — returns info about last Pirsch API calls (for test assertions)
app.get("/api/analytics/status", (req, res) => {
  res.json(lastCallStatus);
});

// DELETE /api/analytics/status — reset call tracking
app.delete("/api/analytics/status", (req, res) => {
  lastCallStatus = { success: null, error: null, calls: [] };
  res.json({ reset: true });
});

// GET / — serve the test HTML page
app.get("/", (req, res) => {
  res.send(getTestPage());
});

function getTestPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Analytics E2E Test Page</title>
</head>
<body>
  <h1>Analytics E2E Test Page</h1>
  <p>This page tests the trackle proxy flow.</p>
  <button id="track-btn">Track Custom Event</button>
  <button id="identify-btn">Identify User</button>
  <div id="status">Ready</div>

  <script type="module">
    // Import ProxyProvider from the built client bundle
    // We serve it from the dist directory
    const { ProxyProvider } = await import('/dist/providers/client.js');
    const { createClientAnalytics } = await import('/dist/client.js');

    const proxyProvider = new ProxyProvider({
      endpoint: '/api/analytics',
      batch: {
        size: 1,      // Flush immediately for testing
        interval: 100, // 100ms max wait
      },
      debug: true,
    });

    const analytics = createClientAnalytics({
      providers: [proxyProvider],
      debug: true,
      enabled: true,
    });

    await analytics.initialize();

    // Track page view immediately on load
    analytics.pageView({ test_page: 'e2e', framework: 'playwright' });

    document.getElementById('track-btn').addEventListener('click', async () => {
      document.getElementById('status').textContent = 'Tracking event...';
      analytics.track('button_clicked', { button: 'track-btn', page: 'test' });
      document.getElementById('status').textContent = 'Event queued';
    });

    document.getElementById('identify-btn').addEventListener('click', () => {
      analytics.identify('test-user-123', { email: 'test@example.com', plan: 'pro' });
      document.getElementById('status').textContent = 'Identify queued';
    });

    // Expose analytics to window for test access
    window.__analytics = analytics;
    window.__analyticsReady = true;
  </script>
</body>
</html>`;
}

// Serve dist files for client-side imports (must be registered before listen)
app.use("/dist", express.static(join(dirname(fileURLToPath(import.meta.url)), "../../dist")));

const PORT = process.env.PORT || 3737;
const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Test Server] Running on http://localhost:${PORT}`);
});

export { server, app };

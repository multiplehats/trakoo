/**
 * Test server for visitors.now E2E tests.
 *
 * Serves a minimal HTML page that initialises VisitorsClientProvider from the
 * built dist bundle.  All tracking calls go directly from the browser to the
 * visitors.now CDN – the server's only job is to deliver the page and the dist
 * files.
 *
 * Run with:
 *   node e2e/visitors-test-app/server.js
 */

import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../../dist");

const VISITORS_TOKEN = process.env.VISITORS_TOKEN || "d0f0543d-d18c-451a-9e3c-d911d17f065c";

const app = express();
app.use(express.json());

// Serve dist files so the browser can import provider modules
app.use("/dist", express.static(distPath));

// GET / – serve the test HTML page
app.get("/", (_req, res) => {
  res.send(buildTestPage(VISITORS_TOKEN));
});

function buildTestPage(token) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Visitors E2E Test Page</title>
</head>
<body>
  <h1>Visitors E2E Test Page</h1>
  <p>Testing trackle VisitorsClientProvider</p>

  <button id="track-btn">Track Custom Event</button>
  <button id="identify-btn">Identify User</button>
  <button id="pageleave-btn">Simulate Page Leave</button>
  <button id="track-revenue-btn">Track Revenue Event</button>
  <div id="status">Initialising…</div>
  <div id="visitor-id"></div>

  <script type="module">
    const { VisitorsClientProvider } = await import('/dist/providers/client.js');
    const { createClientAnalytics } = await import('/dist/client.js');

    const provider = new VisitorsClientProvider({
      token: '${token}',
      debug: true,
    });

    const analytics = createClientAnalytics({
      providers: [provider],
      debug: true,
      enabled: true,
    });

    try {
      await analytics.initialize();
      document.getElementById('status').textContent = 'Ready';

      // Expose visitor ID for Stripe attribution assertions
      const visitorId = provider.getVisitorId();
      document.getElementById('visitor-id').textContent = visitorId ?? 'no-cookie';
    } catch (err) {
      document.getElementById('status').textContent = 'Error: ' + err.message;
      console.error('[Test Page] Init error:', err);
    }

    // Automatic page view on load (visitors.now handles this via the script tag)
    analytics.pageView({ test_page: 'e2e', framework: 'playwright' });

    document.getElementById('track-btn').addEventListener('click', () => {
      analytics.track('button_clicked', { button: 'track-btn', page: 'test', value: 42 });
      document.getElementById('status').textContent = 'Event tracked';
    });

    document.getElementById('identify-btn').addEventListener('click', () => {
      analytics.identify('test-user-e2e', {
        email: 'e2e@example.com',
        name: 'E2E Test User',
        plan: 'pro',
        seats: 5,
      });
      document.getElementById('status').textContent = 'User identified';
    });

    document.getElementById('pageleave-btn').addEventListener('click', () => {
      analytics.pageLeave({ page: 'test', section: 'hero' });
      document.getElementById('status').textContent = 'Page leave tracked';
    });

    document.getElementById('track-revenue-btn').addEventListener('click', () => {
      // Simulate a conversion event (e.g. before redirecting to Stripe)
      analytics.track('checkout_started', { plan: 'pro', amount: 2900 });
      document.getElementById('status').textContent = 'Revenue event tracked';
    });

    window.__visitorsProvider = provider;
    window.__analytics = analytics;
    window.__analyticsReady = true;
  </script>
</body>
</html>`;
}

const PORT = process.env.PORT || 3738;
const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Visitors Test Server] Running on http://localhost:${PORT}`);
  console.log(`[Visitors Test Server] Token: ${VISITORS_TOKEN}`);
});

export { server, app };

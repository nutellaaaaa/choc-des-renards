// Vercel Speed Insights Initialization
// This file loads and initializes Vercel Speed Insights for performance tracking

import { injectSpeedInsights } from '@vercel/speed-insights';

// Initialize Speed Insights
injectSpeedInsights({
  debug: false, // Set to true to enable debug logging in development
});

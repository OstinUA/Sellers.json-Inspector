/**
 * Sellers.json Inspector — Background Service Worker
 * 
 * Handles cross-origin fetch requests from the content script.
 * Features:
 *  - URL scheme validation (only https allowed)
 *  - Domain-level response caching to avoid duplicate fetches
 *  - Configurable timeout with AbortController
 *  - Path whitelist: only /ads.txt and /app-ads.txt are permitted
 */

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const ALLOWED_PATHS = ['/ads.txt', '/app-ads.txt'];

/**
 * Simple in-memory cache with TTL.
 * Key: full URL string, Value: { text, timestamp }
 */
const fetchCache = new Map();

function isUrlAllowed(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:') return false;
    if (!ALLOWED_PATHS.includes(url.pathname)) return false;
    if (url.username || url.password) return false;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') return false;
    // block private/internal IPs (basic check)
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function getCachedResponse(url) {
  const cached = fetchCache.get(url);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached;
  }
  if (cached) {
    fetchCache.delete(url);
  }
  return null;
}

function setCachedResponse(url, text, success) {
  fetchCache.set(url, { text, success, timestamp: Date.now() });
  // prevent unbounded growth
  if (fetchCache.size > 2000) {
    const oldest = fetchCache.keys().next().value;
    fetchCache.delete(oldest);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchAds') {
    const url = request.url;

    // Validate URL
    if (!isUrlAllowed(url)) {
      sendResponse({ text: null, success: false, error: 'blocked_url' });
      return false;
    }

    // Check cache
    const cached = getCachedResponse(url);
    if (cached) {
      sendResponse({ text: cached.text, success: cached.success, fromCache: true });
      return false;
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'text/plain' }
    })
      .then(res => {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(text => {
        // Limit response size to 5MB to prevent memory issues
        if (text.length > 5 * 1024 * 1024) {
          throw new Error('Response too large');
        }
        setCachedResponse(url, text, true);
        sendResponse({ text, success: true });
      })
      .catch(err => {
        clearTimeout(timeoutId);
        setCachedResponse(url, null, false);
        sendResponse({ text: null, success: false, error: err.message });
      });

    return true; // async response
  }

  if (request.action === 'clearCache') {
    fetchCache.clear();
    sendResponse({ success: true });
    return false;
  }
});
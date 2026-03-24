// ── Tracking URL & Number Extraction ─────────────────────────────────────────
// Extracts tracking URLs and carrier tracking numbers from email HTML.
// Parses <a> tags for Amazon tracking links, decodes redirect wrappers,
// and regex-scans for known carrier tracking number formats.

export interface TrackingInfo {
  tracking_number?: string;
  carrier?: string;
  tracking_url?: string;
}

// Amazon tracking URL patterns (in href attributes)
const AMAZON_TRACKING_PATTERNS = [
  /ship-?track/i,
  /progress-tracker/i,
  /gp\/your-account\/ship/i,
];

/**
 * Extract tracking info (URL, tracking number, carrier) from email HTML.
 * 1. Finds Amazon tracking <a> links and extracts tracking URLs
 * 2. Decodes Amazon redirect wrappers (gp/r.html?...&U=encoded-url)
 * 3. Extracts trackingId parameter from URLs
 * 4. Regex-scans HTML for known carrier tracking number formats
 */
export function extractTrackingInfo(html: string): TrackingInfo {
  const result: TrackingInfo = {};

  // ── Step 1: Extract tracking URLs from <a> tags ──────────────────────────
  const trackingUrls = extractTrackingUrls(html);
  if (trackingUrls.length > 0) {
    result.tracking_url = trackingUrls[0];
  }

  // ── Step 2: Check URL params for trackingId ──────────────────────────────
  for (const url of trackingUrls) {
    const trackingId = extractUrlParam(url, 'trackingId');
    if (trackingId && /^TB[ACM]\d{12}$/.test(trackingId)) {
      result.tracking_number = trackingId;
      result.carrier = 'Amazon Logistics';
      return result;
    }
  }

  // ── Step 3: Regex scan for carrier tracking numbers ──────────────────────
  // Strip HTML tags to get text content, but also scan href values
  const textContent = html.replace(/<[^>]+>/g, ' ');

  // Try Amazon TBA first (most specific, won't false-positive)
  const tbaMatch = textContent.match(/\bTB[ACM]\d{12}\b/);
  if (tbaMatch) {
    result.tracking_number = tbaMatch[0];
    result.carrier = 'Amazon Logistics';
    return result;
  }

  // Try UPS (very specific format)
  const upsMatch = textContent.match(/\b1Z[A-Z0-9]{16}\b/);
  if (upsMatch) {
    result.tracking_number = upsMatch[0];
    result.carrier = 'UPS';
    return result;
  }

  // Try USPS (9x prefix + 19-21 digits)
  const uspsMatch = textContent.match(/\b9[234]\d{19,21}\b/);
  if (uspsMatch) {
    result.tracking_number = uspsMatch[0];
    result.carrier = 'USPS';
    return result;
  }

  // Try OnTrac
  const ontracMatch = textContent.match(/\bC\d{14}\b/);
  if (ontracMatch) {
    result.tracking_number = ontracMatch[0];
    result.carrier = 'OnTrac';
    return result;
  }

  return result;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extract Amazon tracking URLs from <a> tags in HTML.
 * Handles both direct tracking links and Amazon redirect wrappers.
 */
function extractTrackingUrls(html: string): string[] {
  const urls: string[] = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];

    // Decode HTML entities
    href = decodeHtmlEntities(href);

    // Check if this is an Amazon redirect wrapper (gp/r.html)
    if (href.includes('/gp/r.html')) {
      const innerUrl = extractUrlParam(href, 'U');
      if (innerUrl) {
        const decoded = decodeURIComponent(innerUrl);
        if (isAmazonTrackingUrl(decoded)) {
          urls.push(decoded);
          continue;
        }
      }
    }

    // Check if the href itself is a tracking URL
    if (isAmazonTrackingUrl(href)) {
      urls.push(href);
    }
  }

  return urls;
}

/** Check if a URL matches known Amazon tracking patterns */
function isAmazonTrackingUrl(url: string): boolean {
  return AMAZON_TRACKING_PATTERNS.some(p => p.test(url));
}

/** Extract a query parameter value from a URL string */
function extractUrlParam(url: string, param: string): string | null {
  const regex = new RegExp(`[?&]${param}=([^&]+)`);
  const match = url.match(regex);
  return match ? match[1] : null;
}

/** Decode common HTML entities in href attributes */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

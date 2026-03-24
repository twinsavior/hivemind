// ── Delivery Photo Extraction & Storage ──────────────────────────────────────
// Extracts delivery photo URLs from email HTML, downloads and stores locally.
// Photos are stored in data/delivery-photos/ with deterministic filenames.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const PHOTO_DIR = path.join(process.cwd(), 'data', 'delivery-photos');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DOWNLOAD_TIMEOUT = 15_000; // 15s

interface DeliveryPhotoCandidate {
  url: string;
  confidence: 'high' | 'medium';
}

/**
 * Extract candidate delivery photo URLs from HTML email body.
 * Filters out logos, icons, tracking pixels, and product thumbnails.
 * Returns candidates sorted by confidence (high first).
 */
export function extractDeliveryPhotoUrls(html: string): DeliveryPhotoCandidate[] {
  const candidates: DeliveryPhotoCandidate[] = [];

  // Parse all <img> tags with src attributes
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const rawSrc = match[1];
    const fullTag = match[0];

    // Skip data URIs and empty srcs
    if (!rawSrc || rawSrc.startsWith('data:')) continue;

    // Decode HTML entities in src (e.g. &amp; → &)
    const src = rawSrc.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

    // Skip tiny images (tracking pixels, icons, spacers)
    const widthMatch = fullTag.match(/width=["']?(\d+)/i);
    const heightMatch = fullTag.match(/height=["']?(\d+)/i);
    const width = widthMatch ? parseInt(widthMatch[1]) : null;
    const height = heightMatch ? parseInt(heightMatch[1]) : null;

    if ((width !== null && width < 100) || (height !== null && height < 100)) continue;

    // Skip common non-photo patterns
    if (isLogoOrIcon(src)) continue;

    // HIGH confidence: delivery photo patterns
    if (isDeliveryPhoto(src, fullTag)) {
      candidates.push({ url: src, confidence: 'high' });
      continue;
    }

    // MEDIUM confidence: large image on a known retailer CDN
    if (isRetailerImage(src)) {
      if ((width === null || width >= 200) && (height === null || height >= 200)) {
        candidates.push({ url: src, confidence: 'medium' });
      }
    }
  }

  // Sort: high confidence first
  candidates.sort((a, b) => {
    if (a.confidence === b.confidence) return 0;
    return a.confidence === 'high' ? -1 : 1;
  });

  return candidates;
}

/**
 * Download a delivery photo from a URL and save it locally.
 * Returns the relative path (e.g. "delivery-photos/amazon_abc123.jpg") or null.
 * Non-fatal: any error returns null.
 */
export async function downloadDeliveryPhoto(
  url: string,
  retailer: string,
  orderNumber: string,
): Promise<string | null> {
  try {
    // Ensure directory exists
    if (!fs.existsSync(PHOTO_DIR)) {
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
    }

    // Generate deterministic filename from retailer + order number
    const hash = crypto.createHash('md5')
      .update(`${retailer}:${orderNumber}`)
      .digest('hex')
      .slice(0, 12);
    const safeRetailer = retailer.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const filename = `${safeRetailer}_${hash}.jpg`;
    const filepath = path.join(PHOTO_DIR, filename);

    // Skip if already downloaded
    if (fs.existsSync(filepath)) {
      return `delivery-photos/${filename}`;
    }

    // Download with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EmailParser/1.0)' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    // Check content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return null;

    const buffer = Buffer.from(await response.arrayBuffer());

    // Validate size
    if (buffer.length > MAX_FILE_SIZE || buffer.length < 1000) return null;

    // Validate it's actually an image
    if (!isImageBuffer(buffer)) return null;

    fs.writeFileSync(filepath, buffer);
    return `delivery-photos/${filename}`;
  } catch {
    return null;
  }
}

/**
 * Delete all stored delivery photos. Called during pipeline reset.
 */
export function clearDeliveryPhotos(): void {
  try {
    if (fs.existsSync(PHOTO_DIR)) {
      const files = fs.readdirSync(PHOTO_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(PHOTO_DIR, file));
      }
    }
  } catch {
    // Non-fatal
  }
}

// ── Heuristic Helpers ────────────────────────────────────────────────────────

function isLogoOrIcon(src: string): boolean {
  const lower = src.toLowerCase();
  return (
    lower.includes('/logo') ||
    lower.includes('brand') ||
    lower.includes('sprite') ||
    lower.includes('icon') ||
    lower.includes('spacer') ||
    lower.includes('pixel') ||
    lower.includes('transparent') ||
    lower.includes('tracking') ||
    lower.includes('beacon') ||
    lower.includes('1x1') ||
    lower.includes('open.') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg')
  );
}

function isDeliveryPhoto(src: string, fullTag: string): boolean {
  const lower = src.toLowerCase();
  const tagLower = fullTag.toLowerCase();

  // URL path patterns
  if (lower.includes('delivery-photo') || lower.includes('deliveryphoto')) return true;
  if (lower.includes('delivery_photo') || lower.includes('proof-of-delivery')) return true;
  if (lower.includes('/photo/') && (lower.includes('amazon') || lower.includes('delivery'))) return true;
  if (lower.includes('/di_photo/') || lower.includes('/di-photo/')) return true;

  // Amazon S3 delivery photo URLs (us-prod-temp.s3.amazonaws.com/imageId-...)
  if (lower.includes('s3.amazonaws.com') && lower.includes('imageid-')) return true;

  // Alt text patterns
  if (tagLower.includes('alt="delivery') || tagLower.includes('alt="photo of')) return true;
  if (tagLower.includes('delivery photo') || tagLower.includes('proof of delivery')) return true;
  if (tagLower.includes('package photo') || tagLower.includes('delivered photo')) return true;

  return false;
}

function isRetailerImage(src: string): boolean {
  const lower = src.toLowerCase();
  return (
    lower.includes('m.media-amazon.com') ||
    lower.includes('images-na.ssl-images-amazon.com') ||
    lower.includes('walmart.com') ||
    lower.includes('target.com') ||
    lower.includes('fedex.com') ||
    lower.includes('ups.com')
  );
}

function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WebP: RIFF....WEBP
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
  return false;
}

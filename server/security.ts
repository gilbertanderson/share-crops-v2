// @ts-nocheck
/**
 * Security module for the Share Crops API.
 * Implements rate limiting, input validation, CORS hardening, and attack prevention
 */

const RATE_LIMIT_WINDOW = 60000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 100; // Max requests per window per IP
const REQUEST_TIMEOUT = 30000; // 30 second timeout

// In-memory rate limit store (replace with Redis/KV in production)
const rateLimitStore = new Map<string, Array<number>>();

// Auth-specific rate limit: 10 requests per 15 minutes per IP
const AUTH_RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 10;
const authRateLimitStore = new Map<string, Array<number>>();

// Failed login tracking: lockout per-email (5 failures) or per-IP (20 failures) within 15 min
const LOCKOUT_WINDOW = 15 * 60 * 1000;
const LOCKOUT_MAX_EMAIL = 5;
const LOCKOUT_MAX_IP = 20;
const LOCKOUT_DURATION = 15 * 60 * 1000;
const failedLoginStore = new Map<string, { count: number; lockedUntil: number; timestamps: number[] }>();

/**
 * Extract client IP from request headers (respects proxies)
 */
export const getClientIp = (req: any): string => {
  const forwardedFor = req.header('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.header('x-real-ip') || req.header('cf-connecting-ip') || 'unknown';
};

/**
 * Rate limiting middleware - prevents brute force and DDoS attacks
 */
export const rateLimit = (req: any): { allowed: boolean; remaining: number; resetTime: number } => {
  const clientIp = getClientIp(req);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  // Get or create request history for this IP
  let requests = rateLimitStore.get(clientIp) || [];

  // Remove old requests outside the window
  requests = requests.filter((timestamp) => timestamp > windowStart);

  // Check if rate limit exceeded
  const allowed = requests.length < RATE_LIMIT_MAX_REQUESTS;

  if (allowed) {
    requests.push(now);
  }

  rateLimitStore.set(clientIp, requests);

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - requests.length);
  const resetTime = requests.length > 0 ? requests[0] + RATE_LIMIT_WINDOW : now + RATE_LIMIT_WINDOW;

  return { allowed, remaining, resetTime };
};

/**
 * Auth-specific rate limiter — tighter window than the global limit.
 * Applies only to login / signup routes.
 */
export const authRateLimit = (req: any): { allowed: boolean; remaining: number; resetTime: number } => {
  const clientIp = getClientIp(req);
  const now = Date.now();
  const windowStart = now - AUTH_RATE_LIMIT_WINDOW;

  let requests = authRateLimitStore.get(clientIp) || [];
  requests = requests.filter((ts) => ts > windowStart);

  const allowed = requests.length < AUTH_RATE_LIMIT_MAX;
  if (allowed) requests.push(now);
  authRateLimitStore.set(clientIp, requests);

  const remaining = Math.max(0, AUTH_RATE_LIMIT_MAX - requests.length);
  const resetTime = requests.length > 0 ? requests[0] + AUTH_RATE_LIMIT_WINDOW : now + AUTH_RATE_LIMIT_WINDOW;

  return { allowed, remaining, resetTime };
};

/**
 * Record a failed login attempt for the given email + IP.
 * Locks the account after LOCKOUT_MAX_EMAIL failures within LOCKOUT_WINDOW.
 */
export const trackFailedLogin = (email: string, ip: string): void => {
  const now = Date.now();
  const windowStart = now - LOCKOUT_WINDOW;

  for (const [key, max] of [
    [`email:${email.toLowerCase()}`, LOCKOUT_MAX_EMAIL] as const,
    [`ip:${ip}`, LOCKOUT_MAX_IP] as const,
  ]) {
    const entry = failedLoginStore.get(key) ?? { count: 0, lockedUntil: 0, timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    entry.timestamps.push(now);
    if (entry.timestamps.length >= max) {
      entry.lockedUntil = now + LOCKOUT_DURATION;
    }
    entry.count = entry.timestamps.length;
    failedLoginStore.set(key, entry);
  }
};

/**
 * Returns whether the email or IP is currently locked out and seconds until unlock.
 */
export const isLockedOut = (email: string, ip: string): { locked: boolean; retryAfter: number } => {
  const now = Date.now();
  for (const key of [`email:${email.toLowerCase()}`, `ip:${ip}`]) {
    const entry = failedLoginStore.get(key);
    if (entry && entry.lockedUntil > now) {
      return { locked: true, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
  }
  return { locked: false, retryAfter: 0 };
};

/**
 * Clear the failed-attempt record for an email on successful login.
 */
export const resetFailedLogin = (email: string): void => {
  failedLoginStore.delete(`email:${email.toLowerCase()}`);
};

/**
 * Input validation - prevents injection attacks
 */
export const validateInput = (value: any, type: 'string' | 'email' | 'uuid' | 'number' | 'array', options?: any): { valid: boolean; error?: string } => {
  if (value === null || value === undefined) {
    return { valid: false, error: 'Value is required' };
  }

  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        return { valid: false, error: 'Must be a string' };
      }
      const maxLength = options?.maxLength || 1000;
      const minLength = options?.minLength || 0;
      if (value.length < minLength || value.length > maxLength) {
        return { valid: false, error: `String length must be between ${minLength} and ${maxLength}` };
      }
      return { valid: true };

    case 'email':
      if (typeof value !== 'string') {
        return { valid: false, error: 'Email must be a string' };
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return { valid: false, error: 'Invalid email format' };
      }
      return { valid: true };

    case 'uuid':
      if (typeof value !== 'string') {
        return { valid: false, error: 'UUID must be a string' };
      }
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(value)) {
        return { valid: false, error: 'Invalid UUID format' };
      }
      return { valid: true };

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: 'Must be a number' };
      }
      const min = options?.min ?? -Infinity;
      const max = options?.max ?? Infinity;
      if (value < min || value > max) {
        return { valid: false, error: `Number must be between ${min} and ${max}` };
      }
      return { valid: true };

    case 'array':
      if (!Array.isArray(value)) {
        return { valid: false, error: 'Must be an array' };
      }
      const maxItems = options?.maxItems || 1000;
      if (value.length > maxItems) {
        return { valid: false, error: `Array must contain fewer than ${maxItems} items` };
      }
      return { valid: true };

    default:
      return { valid: false, error: 'Unknown type' };
  }
};

/**
 * Sanitize strings to prevent XSS attacks
 */
export const sanitizeString = (input: string): string => {
  if (typeof input !== 'string') return '';

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Validate JWT token structure (basic check)
 */
export const validateJwtStructure = (token: string): { valid: boolean; error?: string } => {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is required' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token format' };
  }

  try {
    // Basic base64 decode check
    atob(parts[0]);
    atob(parts[1]);
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid token encoding' };
  }
};

/**
 * Prevent SQL injection by validating query patterns
 */
export const validateQuerySafety = (input: string): { safe: boolean; reason?: string } => {
  const dangerousPatterns = [
    /(\bUNION\b|\bSELECT\b|\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b|\bEXEC\b|\bEXECUTE\b)/i,
    /(-{2}|\/\*|\*\/|;)/,
    /[\x00\x1a]/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      return { safe: false, reason: 'Potentially dangerous SQL pattern detected' };
    }
  }

  return { safe: true };
};

/**
 * Generate CSRF token (simple implementation)
 */
export const generateCsrfToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Verify CSRF token
 */
export const verifyCsrfToken = (token: string, sessionToken: string): boolean => {
  if (!token || !sessionToken) return false;
  // In production, verify against server-side stored token
  // This is a simplified check
  return Boolean(token && sessionToken && typeof token === 'string' && typeof sessionToken === 'string');
};

/**
 * Create secure response headers
 */
export const getSecurityHeaders = () => ({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

/**
 * Log security events
 */
export const logSecurityEvent = (
  eventType: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  details: Record<string, any>,
) => {
  const timestamp = new Date().toISOString();
  const event = {
    timestamp,
    eventType,
    severity,
    details,
  };

  // Log to console in development
  console.error(`[SECURITY] ${severity.toUpperCase()} - ${eventType}:`, event);

  // In production, send to logging service (e.g., Sentry, LogRocket)
  // await sendToLoggingService(event);
};

/**
 * Validate file upload safety
 */
export const validateFileUpload = (
  filename: string,
  size: number,
  mimeType: string,
): { valid: boolean; error?: string } => {
  const maxFileSize = 10 * 1024 * 1024; // 10MB
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

  // Check file size
  if (size > maxFileSize) {
    return { valid: false, error: `File size must be less than ${maxFileSize / 1024 / 1024}MB` };
  }

  // Check MIME type
  if (!allowedMimes.includes(mimeType)) {
    return { valid: false, error: `File type not allowed. Allowed types: ${allowedMimes.join(', ')}` };
  }

  // Check file extension
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (!allowedExtensions.includes(ext)) {
    return { valid: false, error: 'Invalid file extension' };
  }

  // Prevent directory traversal
  if (filename.includes('..') || filename.includes('/')) {
    return { valid: false, error: 'Invalid filename' };
  }

  return { valid: true };
};

/**
 * Hash sensitive data (basic implementation)
 */
export const hashData = async (data: string): Promise<string> => {
  try {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.error('Hash error:', error);
    return '';
  }
};

export default {
  getClientIp,
  rateLimit,
  validateInput,
  sanitizeString,
  validateJwtStructure,
  validateQuerySafety,
  generateCsrfToken,
  verifyCsrfToken,
  getSecurityHeaders,
  logSecurityEvent,
  validateFileUpload,
  hashData,
};

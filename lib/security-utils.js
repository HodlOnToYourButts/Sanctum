// Security utilities for authorization and validation

const logger = require('./logger');

/**
 * Standardized authorization checker
 * @param {Object} user - User object from request
 * @param {string[]} requiredRoles - Array of required roles (e.g., ['admin', 'moderator'])
 * @returns {boolean} - Whether user has required role
 */
function hasRequiredRole(user, requiredRoles) {
  if (!user || !user.roles) {
    return false;
  }

  return requiredRoles.some(role => user.roles.includes(role));
}

/**
 * Check if user can edit content (author or moderator)
 * @param {Object} user - User object from request
 * @param {Object} content - Content object
 * @returns {boolean} - Whether user can edit
 */
function canEditContent(user, content) {
  if (!user || !content) {
    return false;
  }

  // Check if user is the author
  const isAuthor = content.author?.id === user.id;

  // Check if user is moderator
  const isModerator = hasRequiredRole(user, ['admin', 'moderator']);

  return isAuthor || isModerator;
}

/**
 * Check if user can disable content (authors can disable, only moderators can enable)
 * @param {Object} user - User object from request
 * @param {Object} content - Content object
 * @param {boolean} isEnabling - Whether this is an enable (true) or disable (false) action
 * @returns {boolean} - Whether action is allowed
 */
function canToggleContentEnabled(user, content, isEnabling) {
  if (!user || !content) {
    return false;
  }

  const isAuthor = content.author?.id === user.id;
  const isModerator = hasRequiredRole(user, ['admin', 'moderator']);

  // Authors can only disable, moderators can enable/disable
  if (isEnabling) {
    return isModerator;
  } else {
    return isAuthor || isModerator;
  }
}

/**
 * Validate content input with additional security checks
 * @param {Object} content - Content to validate
 * @param {string} contentType - Type of content (blog, forum, etc.)
 * @returns {Object} - Validation result with isValid and errors
 */
function validateContentSecurity(content, contentType) {
  const errors = [];

  // Check for excessively long content
  if (content.title && content.title.length > 500) {
    errors.push('Title too long (max 500 characters)');
  }

  if (content.body && content.body.length > 50000) {
    errors.push('Content too long (max 50,000 characters)');
  }

  // Basic HTML tag detection (for additional security layer)
  const suspiciousPatterns = [
    /<script/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /javascript:/i,
    /data:text\/html/i
  ];

  const textToCheck = `${content.title || ''} ${content.body || ''}`;
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(textToCheck)) {
      errors.push('Content contains potentially unsafe HTML');
      break;
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Rate limiting tracker (simple in-memory implementation)
 */
class RateLimiter {
  constructor() {
    this.requests = new Map(); // userId -> { count, resetTime }
  }

  /**
   * Check if user has exceeded rate limit
   * @param {string} userId - User ID
   * @param {number} maxRequests - Maximum requests allowed
   * @param {number} windowMs - Time window in milliseconds
   * @returns {boolean} - Whether request should be allowed
   */
  checkLimit(userId, maxRequests = 10, windowMs = 60000) {
    const now = Date.now();
    const userRequests = this.requests.get(userId);

    if (!userRequests || now > userRequests.resetTime) {
      // First request or window expired
      this.requests.set(userId, {
        count: 1,
        resetTime: now + windowMs
      });
      return true;
    }

    if (userRequests.count >= maxRequests) {
      return false; // Rate limit exceeded
    }

    userRequests.count++;
    return true;
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup() {
    const now = Date.now();
    for (const [userId, data] of this.requests.entries()) {
      if (now > data.resetTime) {
        this.requests.delete(userId);
      }
    }
  }
}

// Global rate limiter instance
const globalRateLimiter = new RateLimiter();

// Clean up every 5 minutes
setInterval(() => {
  globalRateLimiter.cleanup();
}, 5 * 60 * 1000);

/**
 * Middleware to check rate limits
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 */
function rateLimitMiddleware(maxRequests = 10, windowMs = 60000) {
  return (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const allowed = globalRateLimiter.checkLimit(req.user.id, maxRequests, windowMs);
    if (!allowed) {
      logger.warn('Rate limit exceeded', {
        userId: req.user.id,
        ip: req.ip,
        path: req.path
      });
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    next();
  };
}

/**
 * Sanitize user input for logging (remove sensitive data)
 * @param {Object} data - Data to sanitize
 * @returns {Object} - Sanitized data
 */
function sanitizeForLogging(data) {
  const sensitive = ['password', 'token', 'secret', 'key', 'email'];
  const sanitized = { ...data };

  function sanitizeObject(obj) {
    for (const key in obj) {
      if (sensitive.some(s => key.toLowerCase().includes(s))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  }

  sanitizeObject(sanitized);
  return sanitized;
}

module.exports = {
  hasRequiredRole,
  canEditContent,
  canToggleContentEnabled,
  validateContentSecurity,
  RateLimiter,
  rateLimitMiddleware,
  sanitizeForLogging
};
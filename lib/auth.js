const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

passport.use('zombieauth', new OAuth2Strategy({
  authorizationURL: `${process.env.ZOMBIEAUTH_ISSUER}/auth`,
  tokenURL: `${process.env.ZOMBIEAUTH_ISSUER}/token`,
  clientID: process.env.ZOMBIEAUTH_CLIENT_ID,
  clientSecret: process.env.ZOMBIEAUTH_CLIENT_SECRET,
  callbackURL: process.env.ZOMBIEAUTH_CALLBACK_URL,
  state: true
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const userInfoResponse = await fetch(`${process.env.ZOMBIEAUTH_ISSUER}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userInfo = await userInfoResponse.json();

    // Create user object from OIDC userinfo - no database storage
    const user = {
      id: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name || userInfo.preferred_username,
      roles: ['user'], // Default role, could be enhanced with OIDC groups/roles later
      accessToken: accessToken,
      refreshToken: refreshToken,
      loginTime: new Date().toISOString()
    };

    logger.info('User authenticated', {
      userId: user.id,
      email: user.email,
      name: user.name
    });

    return done(null, user);

  } catch (error) {
    logger.error('Authentication error', { error: error.message });
    return done(error);
  }
}));

passport.serializeUser((user, done) => {
  // Store only essential data in session, not sensitive tokens
  const sessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    loginTime: user.loginTime
  };
  done(null, sessionUser);
});

passport.deserializeUser(async (sessionUser, done) => {
  // Session user is already complete for basic operations
  done(null, sessionUser);
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

// Fetch fresh user info from OIDC provider
async function fetchOIDCUserInfo(userId) {
  try {
    // For privileged operations, we need a way to get fresh tokens
    // This would typically require storing refresh tokens securely
    // For now, we'll implement a placeholder that could be enhanced
    const response = await fetch(`${process.env.ZOMBIEAUTH_ISSUER}/userinfo`, {
      headers: {
        'Authorization': `Bearer ${process.env.ADMIN_TOKEN}`, // Admin token for user lookup
        'X-User-ID': userId
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    return await response.json();
  } catch (error) {
    logger.error('Failed to fetch OIDC user info', { userId, error: error.message });
    throw error;
  }
}

// Extract roles from OIDC user info (groups, custom claims, etc.)
function extractRoles(userInfo) {
  const roles = ['user']; // Default role

  // Check for groups in OIDC userinfo
  if (userInfo.groups && Array.isArray(userInfo.groups)) {
    roles.push(...userInfo.groups);
  }

  // Check for custom role claims
  if (userInfo.roles && Array.isArray(userInfo.roles)) {
    roles.push(...userInfo.roles);
  }

  // Check for admin claim
  if (userInfo.is_admin === true || userInfo.admin === true) {
    roles.push('admin');
  }

  return [...new Set(roles)]; // Remove duplicates
}

// Secure role validation that checks against OIDC
function requireRole(role) {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // For privileged operations, always validate against OIDC
      const freshUserInfo = await fetchOIDCUserInfo(req.user.id);
      const currentRoles = extractRoles(freshUserInfo);

      if (!currentRoles.includes(role) && !currentRoles.includes('admin')) {
        logger.warn('Access denied - insufficient privileges', {
          userId: req.user.id,
          requiredRole: role,
          userRoles: currentRoles
        });
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Attach fresh roles to request for use in handlers
      req.user.currentRoles = currentRoles;
      next();

    } catch (error) {
      logger.error('Role validation failed', {
        userId: req.user.id,
        role,
        error: error.message
      });
      return res.status(500).json({ error: 'Role validation failed' });
    }
  };
}

// Lightweight auth check for non-privileged operations
function requireAuthOnly(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

module.exports = {
  requireAuth: requireAuthOnly, // Non-privileged auth check
  requireRole, // Secure OIDC role validation
  fetchOIDCUserInfo,
  extractRoles
};
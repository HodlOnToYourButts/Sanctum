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
  // Store essential data including access token for OIDC queries
  const sessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    accessToken: user.accessToken, // We need this for OIDC queries
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

// Fetch fresh user info from OIDC provider using user's access token
async function fetchOIDCUserInfo(user) {
  try {
    if (!user.accessToken) {
      throw new Error('No access token available for OIDC query');
    }

    const response = await fetch(`${process.env.ZOMBIEAUTH_ISSUER}/userinfo`, {
      headers: {
        'Authorization': `Bearer ${user.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`OIDC userinfo request failed: ${response.status} ${response.statusText}`);
    }

    const userInfo = await response.json();
    logger.info('OIDC userinfo response', { userInfo }); // Debug log
    return userInfo;
  } catch (error) {
    logger.error('Failed to fetch OIDC user info', {
      userId: user.id,
      error: error.message,
      hasToken: !!user.accessToken
    });
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

  // Check for single role field (ZombieAuth might use this)
  if (userInfo.role && typeof userInfo.role === 'string') {
    roles.push(userInfo.role);
  }

  // Check for admin claim in various formats
  if (userInfo.is_admin === true || userInfo.admin === true) {
    roles.push('admin');
  }

  // Check if user has admin in any role/group field
  const allRoleFields = [
    userInfo.roles,
    userInfo.groups,
    userInfo.authorities,
    userInfo.permissions
  ].filter(field => Array.isArray(field));

  for (const roleField of allRoleFields) {
    for (const role of roleField) {
      if (typeof role === 'string' && role.toLowerCase().includes('admin')) {
        roles.push('admin');
      }
    }
  }

  // Role-based admin detection only - no username assumptions

  const finalRoles = [...new Set(roles)]; // Remove duplicates
  logger.info('Extracted roles from OIDC userinfo', {
    userInfo,
    extractedRoles: finalRoles
  });

  return finalRoles;
}

// Secure role validation that checks against OIDC
function requireRole(role) {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // For privileged operations, always validate against OIDC
      const freshUserInfo = await fetchOIDCUserInfo(req.user);
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
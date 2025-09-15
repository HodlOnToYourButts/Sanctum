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

// Custom OAuth2Strategy with progressive retry logic for token exchange
class RetryOAuth2Strategy extends OAuth2Strategy {
  async _oauth2GetOAuthAccessToken(code, params, callback) {
    const maxRetries = 3;
    const baseDelay = 1000; // Start with 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          super._oauth2GetOAuthAccessToken.call(this, code, params, (err, accessToken, refreshToken, results) => {
            if (err) {
              logger.warn(`Token exchange attempt ${attempt} failed`, {
                error: err.message,
                attempt,
                maxRetries
              });
              reject(err);
            } else {
              logger.info(`Token exchange succeeded on attempt ${attempt}`);
              resolve([accessToken, refreshToken, results]);
            }
          });
        });
      } catch (error) {
        if (attempt === maxRetries) {
          logger.error('Token exchange failed after all retries', {
            error: error.message,
            attempts: maxRetries
          });
          throw error;
        }

        // Progressive backoff: 1s, 2s, 4s
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.info(`Retrying token exchange in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

passport.use('zombieauth', new RetryOAuth2Strategy({
  authorizationURL: `${process.env.ZOMBIEAUTH_ISSUER}/auth`,
  tokenURL: `${process.env.ZOMBIEAUTH_ISSUER}/token`,
  clientID: process.env.ZOMBIEAUTH_CLIENT_ID,
  clientSecret: process.env.ZOMBIEAUTH_CLIENT_SECRET,
  callbackURL: process.env.ZOMBIEAUTH_CALLBACK_URL,
  scope: ['openid', 'profile', 'email', 'roles', 'groups'], // Request additional scopes
  state: true
}, async (accessToken, refreshToken, profile, done) => {
  try {
    logger.info('OAuth2 strategy callback invoked', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken
    });

    const userInfoResponse = await fetch(`${process.env.ZOMBIEAUTH_ISSUER}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!userInfoResponse.ok) {
      throw new Error(`Failed to fetch userinfo: ${userInfoResponse.status} ${userInfoResponse.statusText}`);
    }

    const userInfo = await userInfoResponse.json();

    logger.info('Retrieved user info from OIDC', {
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name || userInfo.preferred_username
    });

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

    logger.info('User authenticated successfully', {
      userId: user.id,
      email: user.email,
      name: user.name
    });

    return done(null, user);

  } catch (error) {
    logger.error('OAuth2 authentication error', {
      error: error.message,
      stack: error.stack
    });
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
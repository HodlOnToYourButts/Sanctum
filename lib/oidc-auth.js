const { URLSearchParams } = require('url');
const crypto = require('crypto');
const winston = require('winston');
const { getClientConfig, getOidcEndpoints } = require('./oidc-client');

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

// Generate a secure random state string for CSRF protection
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

// Redirect to OIDC provider for authentication
function redirectToLogin(req, res) {
  try {
    const clientConfig = getClientConfig(req);
    const endpoints = getOidcEndpoints();

    // Generate state and PKCE for security
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePKCE();

    // Store state and code verifier in session for later verification
    req.session.oidc_state = state;
    req.session.oidc_code_verifier = codeVerifier;

    logger.info('OIDC Login Debug', {
      state,
      sessionId: req.sessionID,
      storedState: req.session.oidc_state
    });

    // Build authorization URL
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: clientConfig.client_id,
      redirect_uri: clientConfig.redirect_uri,
      scope: clientConfig.scope,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `${endpoints.authorization_endpoint}?${authParams}`;
    logger.info('Redirecting to OIDC provider', { authUrl });

    // Ensure session is saved before redirecting
    req.session.save((err) => {
      if (err) {
        logger.error('Error saving session before OIDC redirect', { error: err.message });
        return res.status(500).send('Session error');
      }

      logger.info('Session saved successfully before redirect', {
        finalState: req.session.oidc_state,
        codeVerifierLength: req.session.oidc_code_verifier?.length
      });

      // Add a small delay to ensure session is fully persisted
      setTimeout(() => {
        res.redirect(authUrl);
      }, 50);
    });
  } catch (error) {
    logger.error('Error redirecting to OIDC login', { error: error.message });
    res.status(500).send('Authentication error');
  }
}

// Handle OIDC callback and exchange code for tokens
async function handleCallback(req, res) {
  try {
    const { code, state } = req.query;

    logger.info('OIDC Callback Debug', {
      receivedState: state,
      sessionState: req.session.oidc_state,
      sessionId: req.sessionID,
      sessionKeys: Object.keys(req.session || {})
    });

    // If session data is missing, handle the race condition more gracefully
    if (!req.session.oidc_state && state) {
      logger.info('Session state missing, this may be a race condition...');
      logger.info('Waiting 100ms and retrying callback...');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if session data appeared after brief wait
      if (!req.session.oidc_state) {
        logger.error('Session data still missing after wait');
        // Clear any partial session data and redirect to start over
        req.session.destroy((err) => {
          if (err) logger.error('Session destroy error', { error: err.message });
          return res.redirect('/login');
        });
        return;
      }

      logger.info('Session data appeared after wait, continuing...');
    }

    // Verify state parameter for CSRF protection
    if (!state || state !== req.session.oidc_state) {
      logger.error('Invalid state parameter - state mismatch', {
        expected: req.session.oidc_state,
        received: state
      });
      return res.status(400).send('Invalid state parameter');
    }

    if (!code) {
      logger.error('Missing authorization code');
      return res.status(400).send('Missing authorization code');
    }

    const clientConfig = getClientConfig(req);
    const endpoints = getOidcEndpoints();

    // Wait 3 seconds before token exchange to ensure everything is settled
    logger.info('Waiting 3 seconds before token exchange...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Exchange authorization code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: clientConfig.redirect_uri,
      client_id: clientConfig.client_id,
      client_secret: clientConfig.client_secret,
      code_verifier: req.session.oidc_code_verifier
    });

    logger.info('Exchanging code for tokens', { tokenEndpoint: endpoints.token_endpoint });

    const tokenResponse = await fetch(endpoints.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenParams
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('Token exchange failed', {
        status: tokenResponse.status,
        error: errorText
      });
      return res.status(400).send('Token exchange failed');
    }

    const tokens = await tokenResponse.json();

    // Get user info
    const userInfoResponse = await fetch(endpoints.userinfo_endpoint, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Accept': 'application/json'
      }
    });

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      logger.error('UserInfo request failed', {
        status: userInfoResponse.status,
        error: errorText
      });
      return res.status(400).send('UserInfo request failed');
    }

    const userInfo = await userInfoResponse.json();

    // Create user object similar to Sanctum's existing format
    const user = {
      id: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name || userInfo.preferred_username,
      roles: extractRoles(userInfo),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      loginTime: new Date().toISOString()
    };

    // Store user info in session (for compatibility with existing Sanctum code)
    req.session.oidc_user = user;

    // Clean up temporary session data
    delete req.session.oidc_state;
    delete req.session.oidc_code_verifier;

    logger.info('OIDC authentication successful', {
      userId: user.id,
      email: user.email,
      name: user.name
    });

    // Redirect to home page
    res.redirect('/');

  } catch (error) {
    logger.error('Error handling OIDC callback', { error: error.message });
    res.status(500).send('Authentication error');
  }
}

// Extract roles from OIDC user info (copied from existing Sanctum logic)
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

  const finalRoles = [...new Set(roles)]; // Remove duplicates
  logger.info('Extracted roles from OIDC userinfo', {
    userInfo,
    extractedRoles: finalRoles
  });

  return finalRoles;
}

// Handle logout
function handleLogout(req, res) {
  try {
    const endpoints = getOidcEndpoints();
    const clientConfig = getClientConfig(req);

    // Clear session
    req.session.destroy((err) => {
      if (err) {
        logger.error('Error destroying session', { error: err.message });
      }
    });

    // Check if it's an AJAX request (from JavaScript fetch)
    const acceptsJson = req.headers.accept && req.headers.accept.includes('application/json');
    const isAjax = req.xhr || acceptsJson;

    if (isAjax) {
      // For AJAX requests, return JSON response and let client handle redirect
      const logoutParams = new URLSearchParams({
        post_logout_redirect_uri: clientConfig.post_logout_redirect_uri
      });

      const logoutUrl = `${endpoints.end_session_endpoint}?${logoutParams}`;
      logger.info('AJAX logout - returning logout URL to client', { logoutUrl });

      res.json({
        success: true,
        logoutUrl: logoutUrl,
        message: 'Logged out successfully'
      });
    } else {
      // For regular requests, redirect to OIDC provider logout
      const logoutParams = new URLSearchParams({
        post_logout_redirect_uri: clientConfig.post_logout_redirect_uri
      });

      const logoutUrl = `${endpoints.end_session_endpoint}?${logoutParams}`;
      logger.info('Redirecting to OIDC logout', { logoutUrl });

      res.redirect(logoutUrl);
    }
  } catch (error) {
    logger.error('Error handling logout', { error: error.message });
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      res.status(500).json({ success: false, error: 'Logout failed' });
    } else {
      res.redirect('/');
    }
  }
}

// Middleware to require OIDC authentication
function requireOidcAuth(requiredRole = null) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.session.oidc_user) {
      // Store the original URL for redirect after login
      req.session.oidc_return_to = req.originalUrl;
      return redirectToLogin(req, res);
    }

    // Add user to request object
    req.user = req.session.oidc_user;

    // Check role if required
    if (requiredRole) {
      const userRoles = req.user.roles || [];
      if (!userRoles.includes(requiredRole) && !userRoles.includes('admin')) {
        logger.warn('Access denied - insufficient privileges', {
          userId: req.user.id,
          requiredRole: requiredRole,
          userRoles: userRoles
        });
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    next();
  };
}

// Check if user is authenticated (for compatibility with existing Sanctum code)
function isAuthenticated(req) {
  return !!req.session.oidc_user;
}

// Get current user (for compatibility with existing Sanctum code)
function getCurrentUser(req) {
  return req.session.oidc_user || null;
}

module.exports = {
  redirectToLogin,
  handleCallback,
  handleLogout,
  requireOidcAuth,
  isAuthenticated,
  getCurrentUser,
  extractRoles
};
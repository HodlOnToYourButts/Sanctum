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

// Test users for development
const testUsers = {
  'admin': {
    id: 'dev-admin',
    email: 'admin@test.local',
    name: 'Admin User',
    roles: ['admin'],
    loginTime: new Date().toISOString()
  },
  'moderator': {
    id: 'dev-moderator',
    email: 'moderator@test.local',
    name: 'Moderator User',
    roles: ['moderator'],
    loginTime: new Date().toISOString()
  },
  'contributor': {
    id: 'dev-contributor',
    email: 'contributor@test.local',
    name: 'Contributor User',
    roles: ['contributor'],
    loginTime: new Date().toISOString()
  },
  'user': {
    id: 'dev-user',
    email: 'user@test.local',
    name: 'Regular User',
    roles: ['user'],
    loginTime: new Date().toISOString()
  }
};

function redirectToLogin(req, res) {
  logger.info('Bypass auth: redirecting to login selection page');

  // Get the return URL from query parameter or referrer
  const returnUrl = req.query.return || req.get('Referer') || '/';

  const loginPage = `
<!DOCTYPE html>
<html>
<head>
    <title>Development Login | Sanctum</title>
    <style>
        body { font-family: 'Courier New', monospace; background: #000; color: #00ff41; padding: 2rem; }
        .container { max-width: 600px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 2rem; }
        .user-btn {
            display: block; width: 100%; margin: 1rem 0; padding: 1rem;
            background: #000; color: #00ff41; border: 1px solid #00ff41;
            font-family: 'Courier New', monospace; cursor: pointer; font-size: 1rem;
        }
        .user-btn:hover { background: #00ff41; color: #000; }
        h1 { color: #00ff41; text-align: center; margin-bottom: 2rem; }
        .note { color: #888; font-size: 0.9rem; margin-top: 2rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>[DEV] Login Selection</h1>
        <p>Select a test user to login as:</p>

        <button class="user-btn" onclick="login('admin')">
            > Admin User (admin/admin) - Full access
        </button>
        <button class="user-btn" onclick="login('moderator')">
            > Moderator User (moderator/moderator) - Content moderation
        </button>
        <button class="user-btn" onclick="login('contributor')">
            > Contributor User (contributor/contributor) - Can create content
        </button>
        <button class="user-btn" onclick="login('user')">
            > Regular User (user/user) - Basic access
        </button>

        <div class="note">
            // This is a development-only login bypass.<br>
            // In production, proper OIDC authentication is used.
        </div>
    </div>

    <script>
        const returnUrl = ${JSON.stringify(returnUrl)};

        function login(username) {
            fetch('/callback?dev_user=' + username, { method: 'POST' })
                .then(() => window.location.href = returnUrl)
                .catch(err => console.error('Login failed:', err));
        }
    </script>
</body>
</html>`;

  res.send(loginPage);
}

async function handleCallback(req, res) {
  const devUser = req.query.dev_user || req.body.dev_user;

  if (!devUser || !testUsers[devUser]) {
    logger.warn('Bypass auth: invalid dev user requested', { devUser });
    return res.status(400).json({ error: 'Invalid development user' });
  }

  const user = testUsers[devUser];
  logger.info('Bypass auth: logging in dev user', {
    userId: user.id,
    username: devUser,
    roles: user.roles
  });

  // Store user in session
  req.session.user = user;
  req.session.save((err) => {
    if (err) {
      logger.error('Session save error:', err);
      return res.status(500).json({ error: 'Session error' });
    }

    res.json({
      success: true,
      message: `Logged in as ${user.name}`,
      user: user
    });
  });
}

function handleLogout(req, res) {
  logger.info('Bypass auth: logging out user', {
    userId: req.session.user?.id
  });

  req.session.destroy((err) => {
    if (err) {
      logger.error('Session destroy error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });
}

function getCurrentUser(req) {
  return req.session.user || null;
}

function requireAuth(requiredRole = null) {
  return (req, res, next) => {
    const user = getCurrentUser(req);

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (requiredRole && !user.roles.includes(requiredRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    req.user = user;
    next();
  };
}

module.exports = {
  redirectToLogin,
  handleCallback,
  handleLogout,
  getCurrentUser,
  requireOidcAuth: requireAuth, // Compatible interface
  testUsers
};
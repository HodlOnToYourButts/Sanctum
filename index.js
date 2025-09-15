require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const winston = require('winston');

const database = require('./lib/database');
require('./lib/auth');
const contentRoutes = require('./routes/content');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'sanctum.log' })
  ]
});

const app = express();
const PORT = 8080;

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: false
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'phoenix-cms-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.static('public'));

// Auth routes at root level
app.get('/login', passport.authenticate('zombieauth'));

// Track processed authorization codes to prevent double-processing
const processedCodes = new Set();

app.get('/callback', (req, res, next) => {
  const authCode = req.query.code;
  const state = req.query.state;

  logger.info('OAuth callback received', {
    hasCode: !!authCode,
    hasState: !!state,
    sessionId: req.sessionID
  });

  // Check if this authorization code was already processed
  if (authCode && processedCodes.has(authCode)) {
    logger.warn('Duplicate authorization code detected', { authCode: authCode.substring(0, 10) + '...' });
    return res.redirect('/login?error=duplicate_request');
  }

  // Mark this code as being processed
  if (authCode) {
    processedCodes.add(authCode);
    // Clean up old codes after 5 minutes
    setTimeout(() => processedCodes.delete(authCode), 5 * 60 * 1000);
  }

  // Add error handling and prevent double processing
  passport.authenticate('zombieauth', {
    failureRedirect: '/login',
    session: true
  }, (err, user, info) => {
    if (err) {
      logger.error('OAuth callback error', {
        error: err.message,
        code: authCode ? authCode.substring(0, 10) + '...' : 'none',
        state: state
      });
      return res.redirect('/login?error=auth_failed');
    }

    if (!user) {
      logger.warn('OAuth callback failed - no user', { info });
      return res.redirect('/login?error=auth_failed');
    }

    // Log in the user
    req.logIn(user, (err) => {
      if (err) {
        logger.error('Login error after OAuth success', { error: err.message });
        return res.redirect('/login?error=login_failed');
      }

      logger.info('User successfully authenticated via OAuth', {
        userId: user.id,
        email: user.email,
        sessionId: req.sessionID
      });

      res.redirect('/');
    });
  })(req, res, next);
});

app.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/user', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Always try to fetch fresh data from OIDC first, fallback to session
    const { fetchOIDCUserInfo, extractRoles } = require('./lib/auth');

    try {
      const freshUserInfo = await fetchOIDCUserInfo(req.user);
      const currentRoles = extractRoles(freshUserInfo);

      res.json({
        id: req.user.id,
        email: freshUserInfo.email,
        name: freshUserInfo.name || freshUserInfo.preferred_username,
        roles: currentRoles,
        lastUpdated: new Date().toISOString(),
        source: 'oidc'
      });
    } catch (oidcError) {
      logger.warn('Failed to fetch fresh OIDC data, using session data', {
        userId: req.user.id,
        error: oidcError.message
      });

      // Fallback to session data if OIDC fails
      res.json({
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        roles: ['user'], // Fallback role
        lastUpdated: req.user.loginTime,
        source: 'session_fallback'
      });
    }
  } catch (error) {
    logger.error('Failed to fetch user data', {
      userId: req.user.id,
      error: error.message
    });
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Site settings API
app.get('/api/settings', async (req, res) => {
  try {
    await database.connect();
    const db = database.getDb();

    try {
      const settings = await db.get('site_settings');
      res.json({
        name: settings.name || 'Sanctum CMS',
        description: settings.description || '',
        updated_at: settings.updated_at
      });
    } catch (error) {
      if (error.statusCode === 404) {
        // Default settings if none exist
        res.json({
          name: 'Sanctum CMS',
          description: '',
          updated_at: null
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error('Failed to fetch site settings', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch site settings' });
  }
});

app.put('/api/settings', async (req, res) => {
  const { requireRole } = require('./lib/auth');

  // Check admin role
  await requireRole('admin')(req, res, async () => {
    try {
      const { name, description } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Site name is required' });
      }

      await database.connect();
      const db = database.getDb();

      let settings = {
        _id: 'site_settings',
        type: 'settings',
        name: name.trim(),
        description: description ? description.trim() : '',
        updated_at: new Date().toISOString(),
        updated_by: req.user.id
      };

      try {
        const existing = await db.get('site_settings');
        settings._rev = existing._rev;
      } catch (error) {
        // Document doesn't exist, will create new one
      }

      await db.insert(settings);

      logger.info('Site settings updated', {
        userId: req.user.id,
        siteName: settings.name
      });

      res.json({ message: 'Settings updated successfully' });
    } catch (error) {
      logger.error('Failed to update site settings', {
        userId: req.user.id,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to update site settings' });
    }
  });
});

app.use('/api/content', contentRoutes);

app.get('/health', async (req, res) => {
  const dbHealth = await database.healthCheck();
  res.json({
    status: dbHealth ? 'healthy' : 'unhealthy',
    database: dbHealth ? 'connected' : 'disconnected',
    instance: process.env.INSTANCE_ID || 'unknown',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

app.get('/b', (req, res) => {
  res.sendFile(__dirname + '/public/blogs.html');
});

app.get('/f', (req, res) => {
  res.sendFile(__dirname + '/public/forums.html');
});

// Keep old routes for backwards compatibility
app.get('/blogs', (req, res) => {
  res.redirect('/b');
});

app.get('/forums', (req, res) => {
  res.redirect('/f');
});

app.get('/api', (req, res) => {
  res.json({
    message: 'Sanctum API',
    version: '0.1.0',
    instance: process.env.INSTANCE_ID || 'unknown',
    endpoints: {
      health: '/health',
      auth: '/auth',
      content: '/api/content'
    }
  });
});

async function start() {
  try {
    await database.connect();

    app.listen(PORT, () => {
      logger.info(`Sanctum running on port ${PORT}`, {
        instance: process.env.INSTANCE_ID || 'unknown',
        port: PORT
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

start();

module.exports = app;
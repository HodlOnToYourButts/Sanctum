require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const winston = require('winston');

const database = require('./lib/database');

// Use bypass auth in development, OIDC in production
const authModule = (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true')
  ? require('./lib/bypass-auth')
  : require('./lib/oidc-auth');

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

// Passport removed - using manual OIDC implementation

app.use(express.static('public'));

// Auth routes at root level
app.get('/login', (req, res, next) => {
  logger.info('Login route accessed', {
    developmentMode: process.env.DEVELOPMENT_MODE === 'true',
    bypassAuth: process.env.BYPASS_AUTH === 'true',
    sessionId: req.sessionID,
    userAgent: req.get('User-Agent'),
    query: req.query
  });
  authModule.redirectToLogin(req, res);
});

// Callback handler (OIDC or bypass)
app.get('/callback', async (req, res) => {
  await authModule.handleCallback(req, res);
});

app.post('/callback', async (req, res) => {
  await authModule.handleCallback(req, res);
});

app.post('/logout', (req, res) => {
  authModule.handleLogout(req, res);
});

app.get('/user', async (req, res) => {
  const user = authModule.getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    lastUpdated: user.loginTime,
    source: 'oidc'
  });
});

// Site settings API
app.get('/api/settings', async (req, res) => {
  try {
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

app.put('/api/settings', authModule.requireOidcAuth('admin'), async (req, res) => {
    try {
      const { name, description } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Site name is required' });
      }

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

// Debug route for OAuth2 configuration (remove in production)
app.get('/debug/oauth', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  res.json({
    issuer: process.env.ISSUER || 'NOT_SET',
    clientId: process.env.CLIENT_ID ? 'SET' : 'NOT_SET',
    clientSecret: process.env.CLIENT_SECRET ? 'SET' : 'NOT_SET',
    callbackUrl: process.env.CALLBACK_URL || 'NOT_SET',
    expectedCallback: `${req.protocol}://${req.get('host')}/callback`
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

// === NEW CLEAN URL STRUCTURE ===

// Blog routes
app.get('/blogs', (req, res) => {
  res.sendFile(__dirname + '/public/blogs.html');
});

app.get('/blogs/top', (req, res) => {
  res.sendFile(__dirname + '/public/blogs.html');
});

app.get('/blogs/create', (req, res) => {
  res.sendFile(__dirname + '/public/blog-edit.html');
});

app.get('/blogs/edit/:id', async (req, res) => {
  try {
    const db = database.getDb();
    const fullId = `blog:${req.params.id}`;
    const content = await db.get(fullId);

    // Verify it's actually a blog post
    if (content.type !== 'blog') {
      return res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
        if (err) res.status(404).send('Content not found');
      });
    }

    res.sendFile(__dirname + '/public/blog-edit.html');
  } catch (error) {
    res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
      if (err) res.status(404).send('Content not found');
    });
  }
});

app.get('/blogs/view/:id', async (req, res) => {
  try {
    const db = database.getDb();
    const fullId = `blog:${req.params.id}`;
    const content = await db.get(fullId);

    // Verify it's actually a blog post
    if (content.type !== 'blog') {
      return res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
        if (err) res.status(404).send('Content not found');
      });
    }

    res.sendFile(__dirname + '/public/blog-post.html');
  } catch (error) {
    res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
      if (err) res.status(404).send('Content not found');
    });
  }
});

// Forum routes
app.get('/forums', (req, res) => {
  res.sendFile(__dirname + '/public/forums.html');
});

app.get('/forums/category/:category', (req, res) => {
  res.sendFile(__dirname + '/public/forums.html');
});

app.get('/forums/category/:category/top', (req, res) => {
  res.sendFile(__dirname + '/public/forums.html');
});

app.get('/forums/create/:category', (req, res) => {
  res.sendFile(__dirname + '/public/forum-edit.html');
});

app.get('/forums/edit/:id', async (req, res) => {
  try {
    const db = database.getDb();
    const fullId = `forum:${req.params.id}`;
    const content = await db.get(fullId);

    // Verify it's actually a forum post
    if (content.type !== 'forum') {
      return res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
        if (err) res.status(404).send('Content not found');
      });
    }

    res.sendFile(__dirname + '/public/forum-edit.html');
  } catch (error) {
    res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
      if (err) res.status(404).send('Content not found');
    });
  }
});

app.get('/forums/view/:id', async (req, res) => {
  try {
    const db = database.getDb();
    const fullId = `forum:${req.params.id}`;
    const content = await db.get(fullId);

    // Verify it's actually a forum post
    if (content.type !== 'forum') {
      return res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
        if (err) res.status(404).send('Content not found');
      });
    }

    res.sendFile(__dirname + '/public/forum-post.html');
  } catch (error) {
    res.status(404).sendFile(__dirname + '/public/404.html', (err) => {
      if (err) res.status(404).send('Content not found');
    });
  }
});

// === LEGACY URL REDIRECTS ===

app.get('/blog', (req, res) => {
  res.redirect(301, '/blogs');
});

app.get('/forum', (req, res) => {
  res.redirect(301, '/forums');
});

app.get('/blog/top', (req, res) => {
  res.redirect(301, '/blogs/top');
});

app.get('/blog/create', (req, res) => {
  res.redirect(301, '/blogs/create');
});

app.get('/blog/edit/:id', (req, res) => {
  res.redirect(301, `/blogs/edit/${req.params.id}`);
});

app.get('/blog/view/:id', (req, res) => {
  res.redirect(301, `/blogs/view/${req.params.id}`);
});

app.get('/forum/category/:category', (req, res) => {
  res.redirect(301, `/forums/category/${req.params.category}`);
});

app.get('/forum/category/:category/top', (req, res) => {
  res.redirect(301, `/forums/category/${req.params.category}/top`);
});

app.get('/forum/create/:category', (req, res) => {
  res.redirect(301, `/forums/create/${req.params.category}`);
});

app.get('/forum/edit/:id', (req, res) => {
  res.redirect(301, `/forums/edit/${req.params.id}`);
});

app.get('/forum/view/:id', (req, res) => {
  res.redirect(301, `/forums/view/${req.params.id}`);
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
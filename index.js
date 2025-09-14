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

app.get('/callback',
  passport.authenticate('zombieauth', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      roles: req.user.roles
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
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

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
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
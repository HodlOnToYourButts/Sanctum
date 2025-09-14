const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');
const database = require('./database');
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
  callbackURL: process.env.ZOMBIEAUTH_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const userInfoResponse = await fetch(`${process.env.ZOMBIEAUTH_ISSUER}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userInfo = await userInfoResponse.json();

    const db = database.getDb();
    let user;

    try {
      const result = await db.view('users', 'by_oidc_id', {
        key: userInfo.sub,
        include_docs: true
      });

      if (result.rows.length > 0) {
        user = result.rows[0].doc;
        user.last_login = new Date().toISOString();
        await db.insert(user);
      } else {
        user = {
          type: 'user',
          oidc_id: userInfo.sub,
          email: userInfo.email,
          name: userInfo.name || userInfo.preferred_username,
          roles: ['user'],
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString()
        };
        const insertResult = await db.insert(user);
        user._id = insertResult.id;
        user._rev = insertResult.rev;
      }

      logger.info('User authenticated', {
        userId: user._id,
        email: user.email,
        oidcId: userInfo.sub
      });
      return done(null, user);

    } catch (dbError) {
      logger.error('Database error during authentication', {
        error: dbError.message,
        oidcId: userInfo.sub
      });
      return done(dbError);
    }

  } catch (error) {
    logger.error('Authentication error', { error: error.message });
    return done(error);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const db = database.getDb();
    const user = await db.get(id);
    done(null, user);
  } catch (error) {
    logger.error('User deserialization error', { userId: id, error: error.message });
    done(error);
  }
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.roles.includes(role) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};
const nano = require('nano');
const { createDesignDocs } = require('./design-docs');
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

class DatabaseManager {
  constructor() {
    this.couch = null;
    this.db = null;
    this.dbName = process.env.COUCHDB_DATABASE || process.env.CMS_DATABASE || 'sanctum';
    this.connected = false;
  }

  async connect() {
    try {
      const couchdbUrl = process.env.COUCHDB_URL || 'http://localhost:5984';
      const username = process.env.COUCHDB_USERNAME;
      const password = process.env.COUCHDB_PASSWORD;

      let connectionUrl = couchdbUrl;
      if (username && password) {
        const url = new URL(couchdbUrl);
        url.username = username;
        url.password = password;
        connectionUrl = url.toString();
      }

      this.couch = nano(connectionUrl);

      // Check if database exists, create if it doesn't
      try {
        this.db = this.couch.use(this.dbName);
        await this.db.info();
        logger.info('Connected to existing CouchDB database', { database: this.dbName });
      } catch (error) {
        if (error.statusCode === 404) {
          // Database doesn't exist, create it
          logger.info('Database does not exist, creating it', { database: this.dbName });
          await this.couch.db.create(this.dbName);
          this.db = this.couch.use(this.dbName);
          await this.db.info();
          logger.info('Created and connected to new CouchDB database', { database: this.dbName });
        } else {
          throw error;
        }
      }

      // Create design documents for views
      await createDesignDocs(this.db);

      this.connected = true;
      return true;
    } catch (error) {
      logger.error('Failed to connect to CouchDB', { error: error.message });
      this.connected = false;
      return false;
    }
  }

  async healthCheck() {
    try {
      if (!this.connected) {
        return false;
      }
      await this.db.info();
      return true;
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      this.connected = false;
      return false;
    }
  }

  getDb() {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    return this.db;
  }
}

module.exports = new DatabaseManager();
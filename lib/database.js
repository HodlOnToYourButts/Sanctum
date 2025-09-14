const nano = require('nano');
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
    this.dbName = process.env.CMS_DATABASE || 'sanctum';
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
      this.db = this.couch.use(this.dbName);

      await this.db.info();
      this.connected = true;

      logger.info('Connected to CouchDB', { database: this.dbName });
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
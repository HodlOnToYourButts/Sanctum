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

async function resolveContentConflict(docId, winningRev, conflictRevs) {
  try {
    const db = database.getDb();

    const winningDoc = await db.get(docId, { rev: winningRev });
    const conflictDocs = await Promise.all(
      conflictRevs.map(rev => db.get(docId, { rev }))
    );

    const latestDoc = [winningDoc, ...conflictDocs]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];

    if (latestDoc._rev !== winningRev) {
      await db.insert(latestDoc);
      logger.info('Conflict resolved by latest timestamp', {
        docId,
        chosenRev: latestDoc._rev,
        conflictRevs
      });
    }

    for (const rev of conflictRevs) {
      try {
        await db.destroy(docId, rev);
      } catch (error) {
        logger.warn('Failed to delete conflict revision', { docId, rev, error: error.message });
      }
    }

    return latestDoc;
  } catch (error) {
    logger.error('Failed to resolve conflict', { docId, error: error.message });
    throw error;
  }
}

async function findAndResolveConflicts() {
  try {
    const db = database.getDb();
    const conflicts = await db.view('_all_docs', {
      conflicts: true,
      include_docs: true
    });

    const conflictedDocs = conflicts.rows.filter(row => row.doc._conflicts);

    for (const row of conflictedDocs) {
      if (row.doc.type !== 'user') {
        await resolveContentConflict(row.doc._id, row.doc._rev, row.doc._conflicts);
      }
    }

    if (conflictedDocs.length > 0) {
      logger.info('Resolved conflicts', { count: conflictedDocs.length });
    }

  } catch (error) {
    logger.error('Failed to find and resolve conflicts', { error: error.message });
  }
}

module.exports = {
  resolveContentConflict,
  findAndResolveConflicts
};
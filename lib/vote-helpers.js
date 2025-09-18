const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

/**
 * Get vote counts for a content item using CouchDB views
 */
async function getVoteCounts(db, contentId) {
  try {
    const result = await db.view('votes', 'by_content', {
      startkey: [contentId],
      endkey: [contentId, {}],
      group: true
    });

    const votes = { up: 0, down: 0, score: 0 };

    result.rows.forEach(row => {
      const [, voteType] = row.key;
      const count = row.value;

      if (voteType === 'up') {
        votes.up = count;
      } else if (voteType === 'down') {
        votes.down = count;
      }
    });

    votes.score = votes.up - votes.down;
    return votes;
  } catch (error) {
    logger.error('Error getting vote counts', { contentId, error: error.message });
    return { up: 0, down: 0, score: 0 };
  }
}

/**
 * Get user's current vote for a content item
 */
async function getUserVote(db, userId, contentId) {
  try {
    const result = await db.view('votes', 'by_user_content', {
      key: [userId, contentId],
      limit: 1
    });

    if (result.rows.length > 0) {
      return result.rows[0].value; // 'up' or 'down'
    }
    return null;
  } catch (error) {
    logger.error('Error getting user vote', { userId, contentId, error: error.message });
    return null;
  }
}

/**
 * Create or update a vote document
 */
async function createVote(db, contentId, userId, voteType) {
  const voteId = `vote-${contentId}-${userId}`;

  try {
    const voteDoc = {
      _id: voteId,
      type: 'vote',
      content_id: contentId,
      user_id: userId,
      vote_type: voteType,
      timestamp: new Date().toISOString()
    };

    // Check if vote already exists
    try {
      const existingVote = await db.get(voteId);
      voteDoc._rev = existingVote._rev;
    } catch (err) {
      // Vote doesn't exist, will create new
    }

    const result = await db.insert(voteDoc);
    logger.info('Vote created/updated', { contentId, userId, voteType });
    return result;
  } catch (error) {
    logger.error('Error creating vote', { contentId, userId, voteType, error: error.message });
    throw error;
  }
}

/**
 * Remove a user's vote
 */
async function removeVote(db, contentId, userId) {
  const voteId = `vote-${contentId}-${userId}`;

  try {
    const existingVote = await db.get(voteId);
    await db.destroy(existingVote._id, existingVote._rev);
    logger.info('Vote removed', { contentId, userId });
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      // Vote doesn't exist, which is fine
      return true;
    }
    logger.error('Error removing vote', { contentId, userId, error: error.message });
    throw error;
  }
}

/**
 * Get vote counts for multiple content items efficiently
 */
async function getBulkVoteCounts(db, contentIds) {
  try {
    if (!contentIds || contentIds.length === 0) {
      return {};
    }

    const keys = [];
    contentIds.forEach(contentId => {
      keys.push([contentId, 'up']);
      keys.push([contentId, 'down']);
    });

    const result = await db.view('votes', 'by_content', {
      keys: keys,
      group: true
    });

    const voteCounts = {};

    // Initialize all content with zero votes
    contentIds.forEach(contentId => {
      voteCounts[contentId] = { up: 0, down: 0, score: 0 };
    });

    // Fill in actual vote counts
    result.rows.forEach(row => {
      const [contentId, voteType] = row.key;
      const count = row.value;

      if (voteCounts[contentId]) {
        voteCounts[contentId][voteType] = count;
      }
    });

    // Calculate scores
    Object.keys(voteCounts).forEach(contentId => {
      voteCounts[contentId].score = voteCounts[contentId].up - voteCounts[contentId].down;
    });

    return voteCounts;
  } catch (error) {
    logger.error('Error getting bulk vote counts', { contentIds, error: error.message });
    return {};
  }
}

module.exports = {
  getVoteCounts,
  getUserVote,
  createVote,
  removeVote,
  getBulkVoteCounts
};
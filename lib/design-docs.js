// CouchDB Design Documents for Views
const designDocs = {
  votes: {
    _id: '_design/votes',
    views: {
      // View to count votes by content
      by_content: {
        map: function(doc) {
          if (doc.type === 'vote') {
            emit([doc.content_id, doc.vote_type], 1);
          }
        }.toString(),
        reduce: function(keys, values) {
          return sum(values);
        }.toString()
      },

      // View to get user's vote for specific content
      by_user_content: {
        map: function(doc) {
          if (doc.type === 'vote') {
            emit([doc.user_id, doc.content_id], doc.vote_type);
          }
        }.toString()
      },

      // View to get all votes for a content item (for debugging/admin)
      by_content_detailed: {
        map: function(doc) {
          if (doc.type === 'vote') {
            emit(doc.content_id, {
              user_id: doc.user_id,
              vote_type: doc.vote_type,
              timestamp: doc.timestamp
            });
          }
        }.toString()
      }
    }
  }
};

async function createDesignDocs(db) {
  for (const [name, designDoc] of Object.entries(designDocs)) {
    try {
      // Check if design doc exists
      try {
        const existing = await db.get(designDoc._id);
        designDoc._rev = existing._rev;
      } catch (err) {
        // Design doc doesn't exist, will create new
      }

      await db.insert(designDoc);
      console.log(`Created/updated design document: ${designDoc._id}`);
    } catch (error) {
      console.error(`Error creating design document ${designDoc._id}:`, error.message);
    }
  }
}

module.exports = { createDesignDocs };
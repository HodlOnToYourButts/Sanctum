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
  },

  content: {
    _id: '_design/content',
    views: {
      // Optimized view for content feed with sorting
      feed: {
        map: function(doc) {
          if (doc.type === 'blog' || doc.type === 'forum' || doc.type === 'page') {
            var timestamp = new Date(doc.created_at).getTime();
            emit([doc.type, doc.status, doc.enabled !== false ? 1 : 0, timestamp], {
              _id: doc._id,
              type: doc.type,
              title: doc.title,
              body: doc.body.substring(0, 300), // Truncated for performance
              author: doc.author,
              created_at: doc.created_at,
              status: doc.status,
              enabled: doc.enabled,
              featured: doc.featured,
              promoted: doc.promoted,
              pinned: doc.pinned,
              category: doc.category,
              tags: doc.tags
            });
          }
        }.toString()
      },

      // View for forum content by category
      forum_by_category: {
        map: function(doc) {
          if (doc.type === 'forum') {
            var timestamp = new Date(doc.created_at).getTime();
            emit([doc.category, doc.status, doc.enabled !== false ? 1 : 0, doc.pinned ? 0 : 1, timestamp], {
              _id: doc._id,
              title: doc.title,
              body: doc.body.substring(0, 300),
              author: doc.author,
              created_at: doc.created_at,
              status: doc.status,
              enabled: doc.enabled,
              pinned: doc.pinned,
              category: doc.category
            });
          }
        }.toString()
      },

      // View for user stats - count posts by user
      user_posts: {
        map: function(doc) {
          if ((doc.type === 'blog' || doc.type === 'forum') && doc.author && doc.author.name) {
            emit([doc.author.name, doc.type], 1);
          }
        }.toString(),
        reduce: function(keys, values) {
          return sum(values);
        }.toString()
      }
    }
  },

  comments: {
    _id: '_design/comments',
    views: {
      // Count comments/replies by content
      count_by_content: {
        map: function(doc) {
          if ((doc.type === 'comment' || doc.type === 'reply') &&
              (doc.status === 'approved' || doc.status === 'pending') &&
              doc.enabled !== false) {
            emit(doc.content_id, 1);
          }
        }.toString(),
        reduce: function(keys, values) {
          return sum(values);
        }.toString()
      },

      // Get comments/replies by content with details
      by_content: {
        map: function(doc) {
          if ((doc.type === 'comment' || doc.type === 'reply') &&
              (doc.status === 'approved' || doc.status === 'pending') &&
              doc.enabled !== false) {
            var timestamp = new Date(doc.created_at).getTime();
            emit([doc.content_id, timestamp], {
              _id: doc._id,
              type: doc.type,
              content: doc.content,
              author_name: doc.author_name,
              author_email: doc.author_email,
              author_roles: doc.author_roles,
              created_at: doc.created_at,
              status: doc.status,
              enabled: doc.enabled
            });
          }
        }.toString()
      },

      // User stats for comments/replies
      user_activity: {
        map: function(doc) {
          if ((doc.type === 'comment' || doc.type === 'reply') && doc.author_name) {
            emit([doc.author_name, doc.type], 1);
          }
        }.toString(),
        reduce: function(keys, values) {
          return sum(values);
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
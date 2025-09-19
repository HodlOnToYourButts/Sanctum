const express = require('express');
const Joi = require('joi');
const database = require('../lib/database');
const winston = require('winston');
const { getVoteCounts, getUserVote, createVote, removeVote, getBulkVoteCounts } = require('../lib/vote-helpers');

// Use bypass auth in development, OIDC in production
const authModule = process.env.BYPASS_OIDC === 'true'
  ? require('../lib/bypass-auth')
  : require('../lib/oidc-auth');

const { requireOidcAuth } = authModule;

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

const router = express.Router();

const pageSchema = Joi.object({
  type: Joi.string().valid('page').required(),
  title: Joi.string().required(),
  body: Joi.string().required(),
  status: Joi.string().valid('draft', 'published', 'archived').default('published'),
  promoted: Joi.boolean().default(false),
  enabled: Joi.boolean().default(true)
});

const blogSchema = Joi.object({
  type: Joi.string().valid('blog').required(),
  title: Joi.string().required(),
  body: Joi.string().required(),
  tags: Joi.array().items(Joi.string()).default([]),
  status: Joi.string().valid('draft', 'published', 'archived').default('published'),
  promoted: Joi.boolean().default(false),
  enabled: Joi.boolean().default(true)
});

const forumSchema = Joi.object({
  type: Joi.string().valid('forum').required(),
  category: Joi.string().valid('general-discussion', 'announcements', 'support', 'feedback').required(),
  title: Joi.string().required(),
  body: Joi.string().required(),
  tags: Joi.array().items(Joi.string()).default([]),
  status: Joi.string().valid('draft', 'published', 'archived').default('published'),
  promoted: Joi.boolean().default(false),
  pinned: Joi.boolean().default(false),
  enabled: Joi.boolean().default(true)
});

const contentSchema = Joi.alternatives().try(pageSchema, blogSchema, forumSchema);

router.get('/', async (req, res) => {
  try {
    await database.connect(); // Ensure database connection
    const db = database.getDb();
    const { type, status, limit = 20, skip = 0 } = req.query;

    // Use Mango query instead of views for simplicity
    const selector = {
      $or: [
        { type: 'page' },
        { type: 'blog' },
        { type: 'forum' }
      ]
    };

    if (type) {
      selector.$or = [{ type: type }];
    }

    if (status) {
      selector.status = status;
    }

    const result = await db.find({
      selector,
      limit: parseInt(limit),
      skip: parseInt(skip)
      // Remove sort for now to avoid index requirement
    });

    const items = result.docs.map(doc => {
      // Debug logging for author information - log every document
      logger.info('Processing document for display', {
        docId: doc._id,
        docType: doc.type,
        hasAuthor: !!doc.author,
        authorName: doc.author?.name,
        authorNameType: typeof doc.author?.name,
        authorNameLength: doc.author?.name ? doc.author.name.length : 0,
        fullAuthor: doc.author
      });

      return {
        _id: doc._id,
        type: doc.type,
        title: doc.title,
        body: doc.body,
        status: doc.status,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        author_name: doc.author?.name || 'Unknown',
        author_id: doc.author?.id,
        tags: doc.tags || []
      };
    });

    res.json(items);
  } catch (error) {
    logger.error('Error fetching content', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Get homepage feed with promotable content (must be before /:id route)
router.get('/feed', async (req, res) => {
  try {
    await database.connect();
    const db = database.getDb();
    const { type, category, sort = 'new', limit = 20, skip = 0 } = req.query;

    // Simplified selector - just get all content and filter in JavaScript
    const selector = {
      $or: [
        { type: 'page' },
        { type: 'blog' },
        { type: 'forum' }
      ]
    };

    const result = await db.find({
      selector,
      limit: 100 // Get more docs to filter from
    });

    // Check if user is moderator for filtering disabled content
    const isUserModerator = req.user && req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('moderator'));

    // Filter and process results
    let items = result.docs
      .filter(doc => {
        // Only include published content
        if (doc.status !== 'published') return false;

        // Hide disabled content from non-moderators
        if (doc.enabled === false && !isUserModerator) return false;

        // Filter by type and promotion status
        if (type && type !== 'all') {
          // For specific type pages (/blogs, /forums), show all published content of that type
          if (doc.type !== type) return false;

          // Additional category filtering for forum posts
          if (type === 'forum' && category && doc.category !== category) {
            return false;
          }

          return true;
        }
        // For homepage ('all'), only show explicitly featured content
        if (type === 'all') {
          return doc.featured === true;
        }
        return true;
      })
      .map(doc => ({
        _id: doc._id,
        type: doc.type,
        category: doc.category, // Include category for forum posts
        title: doc.title,
        body: doc.body ? (doc.body.substring(0, 300) + (doc.body.length > 300 ? '...' : '')) : '',
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        author_name: doc.author?.name,
        author_id: doc.author?.id,
        tags: doc.tags || [],
        votes: { up: 0, down: 0, score: 0 }, // Will be populated below
        allow_comments: doc.allow_comments,
        comment_count: 0, // Will be calculated below
        featured: doc.featured || false,
        pinned: doc.pinned || false
      }));

    // Get vote counts for all items efficiently using bulk query
    const contentIds = items.map(item => item._id);
    const voteCounts = await getBulkVoteCounts(db, contentIds);

    // Apply vote counts to items
    items.forEach(item => {
      if (voteCounts[item._id]) {
        item.votes = voteCounts[item._id];
      }
    });

    // Sort items
    if (sort === 'top') {
      items.sort((a, b) => b.votes.score - a.votes.score);
    } else {
      // Sort by newest first (created_at)
      items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Calculate comment/reply counts for items that allow comments
    for (let item of items) {
      if (['blog', 'forum'].includes(item.type)) {
        try {
          // Use different types for different content types
          const responseType = item.type === 'forum' ? 'reply' : 'comment';
          const responseResult = await db.find({
            selector: {
              type: responseType,
              content_id: item._id,
              status: { $in: ['approved', 'pending'] }
            }
          });
          item.comment_count = responseResult.docs.length;
        } catch (error) {
          logger.error('Error counting responses', { contentId: item._id, error: error.message });
          item.comment_count = 0;
        }
      }
    }

    // Apply limit and skip
    items = items.slice(parseInt(skip), parseInt(skip) + parseInt(limit));

    res.json(items);
  } catch (error) {
    logger.error('Error fetching content feed', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Failed to fetch content feed',
      details: error.message
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const db = database.getDb();
    const content = await db.get(req.params.id);

    if (content.type === 'user') {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if content is disabled and user is not a moderator
    const isUserModerator = req.user && req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('moderator'));
    if (content.enabled === false && !isUserModerator) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Calculate comment/reply count for this content
    if (['blog', 'forum'].includes(content.type)) {
      try {
        const responseType = content.type === 'forum' ? 'reply' : 'comment';
        const responseResult = await db.find({
          selector: {
            type: responseType,
            content_id: content._id,
            status: { $in: ['approved', 'pending'] }
          }
        });
        content.comment_count = responseResult.docs.length;
      } catch (error) {
        logger.error('Error counting responses for single content', { contentId: content._id, error: error.message });
        content.comment_count = 0;
      }
    }

    // Get vote counts for this content item
    try {
      const votes = await getVoteCounts(db, content._id);
      content.votes = votes;
    } catch (error) {
      logger.error('Error getting votes for content', { contentId: content._id, error: error.message });
      content.votes = { up: 0, down: 0, score: 0 };
    }

    // Transform the content to match frontend expectations
    const transformedContent = {
      ...content,
      author_name: content.author?.name || 'Unknown',
      author_id: content.author?.id
    };

    res.json(transformedContent);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error fetching content', { id: req.params.id, error: error.message });
      res.status(500).json({ error: 'Failed to fetch content' });
    }
  }
});

router.post('/', requireOidcAuth(), async (req, res) => {
  try {
    const { error, value } = contentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    await database.connect(); // Ensure database connection
    const db = database.getDb();

    // Debug logging for author information
    logger.info('Creating content with user info', {
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRoles: req.user.roles,
      fullUser: req.user
    });

    const content = {
      ...value,
      author: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        roles: req.user.roles || []
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      votes: {
        up: 0,
        down: 0,
        score: 0
      },
      voter_list: [] // Track who voted to prevent duplicate votes
    };

    // Always enable comments for all content
    content.allow_comments = true;


    const result = await db.insert(content);
    content._id = result.id;
    content._rev = result.rev;

    logger.info('Content created', {
      contentId: content._id,
      authorId: req.user.id,
      title: content.title,
      type: content.type
    });

    res.status(201).json(content);
  } catch (error) {
    logger.error('Error creating content', { error: error.message });
    res.status(500).json({ error: 'Failed to create content' });
  }
});

router.put('/:id', requireOidcAuth(), async (req, res) => {
  try {
    const { error, value } = contentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const db = database.getDb();
    const existingContent = await db.get(req.params.id);

    if (existingContent.type === 'user') {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if user can edit this content (author, admin, or moderator)
    const isAuthor = existingContent.author?.id === req.user.id;
    const isModerator = req.user.roles.includes('admin') || req.user.roles.includes('moderator');

    if (!isAuthor && !isModerator) {
      return res.status(403).json({ error: 'Cannot edit content by another author' });
    }

    const updatedContent = {
      ...existingContent,
      ...value,
      updated_at: new Date().toISOString()
    };

    const result = await db.insert(updatedContent);
    updatedContent._rev = result.rev;

    logger.info('Content updated', {
      contentId: updatedContent._id,
      authorId: req.user.id,
      title: updatedContent.title
    });

    res.json(updatedContent);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error updating content', { id: req.params.id, error: error.message });
      res.status(500).json({ error: 'Failed to update content' });
    }
  }
});

router.delete('/:id', requireOidcAuth(), async (req, res) => {
  try {
    const db = database.getDb();
    const content = await db.get(req.params.id);

    if (content.type === 'user') {
      return res.status(404).json({ error: 'Content not found' });
    }

    if (content.author.id !== req.user.id && !(req.user.currentRoles && req.user.currentRoles.includes('admin'))) {
      return res.status(403).json({ error: 'Cannot delete content by another author' });
    }

    await db.destroy(req.params.id, content._rev);

    logger.info('Content deleted', {
      contentId: req.params.id,
      authorId: req.user.id,
      title: content.title
    });

    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error deleting content', { id: req.params.id, error: error.message });
      res.status(500).json({ error: 'Failed to delete content' });
    }
  }
});

// Comment system for blogs
const commentSchema = Joi.object({
  content: Joi.string().required().min(1).max(1000),
  author_name: Joi.string().required().min(1).max(100),
  author_email: Joi.string().email({ tlds: { allow: false } }).optional() // Allow any TLD including .local
});

// Get comments for a specific blog post
router.get('/:id/comments', async (req, res) => {
  try {
    await database.connect(); // Ensure database connection
    const db = database.getDb();

    // First check if the content exists and allows comments
    const content = await db.get(req.params.id);
    if (!['blog', 'forum'].includes(content.type)) {
      return res.status(400).json({ error: 'Comments only available for blogs, articles, and forum posts' });
    }

    if (!content.allow_comments) {
      return res.status(403).json({ error: 'Comments are disabled for this post' });
    }

    // Find comments for this content (removed sort to avoid index issues)
    const result = await db.find({
      selector: {
        type: 'comment',
        content_id: req.params.id
      }
    });

    // Sort comments in JavaScript instead
    let comments = result.docs
      .filter(doc => doc.status === 'approved' || doc.status === 'pending') // Only show approved/pending comments
      .map(doc => ({
        _id: doc._id,
        content: doc.content,
        author_name: doc.author_name,
        created_at: doc.created_at,
        status: doc.status
      }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // Sort by date ascending

    res.json(comments);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error fetching comments', {
        id: req.params.id,
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: 'Failed to fetch comments' });
    }
  }
});

// Add a comment to a blog post
router.post('/:id/comments', async (req, res) => {
  try {
    const { error, value } = commentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    await database.connect(); // Ensure database connection
    const db = database.getDb();

    // Check if the content exists and allows comments
    const content = await db.get(req.params.id);
    if (!['blog', 'forum'].includes(content.type)) {
      return res.status(400).json({ error: 'Comments only available for blogs, articles, and forum posts' });
    }

    if (!content.allow_comments) {
      return res.status(403).json({ error: 'Comments are disabled for this post' });
    }

    const comment = {
      type: 'comment',
      content_id: req.params.id,
      content: value.content,
      author_name: value.author_name,
      author_email: value.author_email,
      status: 'pending', // Comments start as pending moderation
      created_at: new Date().toISOString(),
      ip_address: req.ip || req.connection.remoteAddress
    };

    const result = await db.insert(comment);
    comment._id = result.id;
    comment._rev = result.rev;

    logger.info('Comment created', {
      commentId: comment._id,
      contentId: req.params.id,
      authorName: comment.author_name
    });

    res.status(201).json({
      _id: comment._id,
      content: comment.content,
      author_name: comment.author_name,
      created_at: comment.created_at,
      status: comment.status
    });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error creating comment', { error: error.message });
      res.status(500).json({ error: 'Failed to create comment' });
    }
  }
});

// Moderate comments (admin only)
router.put('/:id/comments/:commentId', requireOidcAuth('admin'), async (req, res) => {
  try {
    const { status } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be approved, rejected, or pending' });
    }

    const db = database.getDb();
    const comment = await db.get(req.params.commentId);

    if (comment.type !== 'comment' || comment.content_id !== req.params.id) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    comment.status = status;
    comment.moderated_at = new Date().toISOString();
    comment.moderated_by = req.user.id;

    const result = await db.insert(comment);
    comment._rev = result.rev;

    logger.info('Comment moderated', {
      commentId: comment._id,
      status: status,
      moderatorId: req.user.id
    });

    res.json({ message: 'Comment status updated successfully' });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Comment not found' });
    } else {
      logger.error('Error moderating comment', { error: error.message });
      res.status(500).json({ error: 'Failed to moderate comment' });
    }
  }
});

// Atomic voting system using separate vote documents
router.post('/:id/vote', requireOidcAuth(), async (req, res) => {
  try {
    const { vote } = req.body; // 'up', 'down', or 'remove'

    if (!['up', 'down', 'remove'].includes(vote)) {
      return res.status(400).json({ error: 'Invalid vote type' });
    }

    await database.connect();
    const db = database.getDb();

    // Verify content exists
    const content = await db.get(req.params.id);
    if (!content.type || !['page', 'blog', 'forum'].includes(content.type)) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const contentId = req.params.id;
    const userId = req.user.id;

    // Handle voting with atomic operations
    if (vote === 'remove') {
      await removeVote(db, contentId, userId);
    } else {
      await createVote(db, contentId, userId, vote);
    }

    // Get updated vote counts and user vote
    const [votes, userVote] = await Promise.all([
      getVoteCounts(db, contentId),
      vote === 'remove' ? null : getUserVote(db, userId, contentId)
    ]);

    res.json({
      votes: votes,
      userVote: userVote
    });

    logger.info('Content voted', {
      contentId: contentId,
      userId: userId,
      voteType: vote,
      newScore: votes.score
    });

  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error voting on content', { id: req.params.id, error: error.message });
      res.status(500).json({ error: 'Failed to vote on content' });
    }
  }
});

// Get individual content item by ID
router.get('/:id', async (req, res) => {
  try {
    const db = database.getDb();
    const content = await db.get(req.params.id);

    if (content.status === 'archived' && (!req.user || !req.user.roles.includes('admin'))) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if content is disabled and user is not a moderator
    const isUserModerator = req.user && req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('moderator'));
    if (content.enabled === false && !isUserModerator) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Transform the content to match frontend expectations
    const transformedContent = {
      ...content,
      author_name: content.author?.name || 'Unknown',
      author_id: content.author?.id
    };

    // Debug logging to see what we're returning
    logger.info('Returning individual content', {
      contentId: content._id,
      hasAuthor: !!content.author,
      authorName: content.author?.name,
      transformedAuthorName: transformedContent.author_name,
      fullAuthor: content.author
    });

    res.json(transformedContent);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error fetching content', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch content' });
    }
  }
});

// Promote content to front page (admin/moderator only)
router.post('/:id/promote', requireOidcAuth(), async (req, res) => {
  try {
    // Check if user has permission to promote
    const isModerator = req.user.roles.includes('admin') || req.user.roles.includes('moderator');
    if (!isModerator) {
      return res.status(403).json({ error: 'Only admins and moderators can promote content' });
    }

    const db = database.getDb();
    const content = await db.get(req.params.id);

    // Update the content to mark as featured
    content.featured = true;
    content.featured_at = new Date().toISOString();
    content.featured_by = req.user.id;

    await db.insert(content);

    logger.info('Content promoted to front page', {
      contentId: req.params.id,
      promotedBy: req.user.id
    });

    res.json({ message: 'Content promoted successfully' });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error promoting content', { error: error.message });
      res.status(500).json({ error: 'Failed to promote content' });
    }
  }
});

// Demote content from front page (admin/moderator only)
router.post('/:id/demote', requireOidcAuth(), async (req, res) => {
  try {
    // Check if user has permission to demote
    const isModerator = req.user.roles.includes('admin') || req.user.roles.includes('moderator');
    if (!isModerator) {
      return res.status(403).json({ error: 'Only admins and moderators can demote content' });
    }

    const db = database.getDb();
    const content = await db.get(req.params.id);

    // Update the content to remove featured status
    content.featured = false;
    delete content.featured_at;
    delete content.featured_by;

    await db.insert(content);

    logger.info('Content demoted from front page', {
      contentId: req.params.id,
      demotedBy: req.user.id
    });

    res.json({ message: 'Content demoted successfully' });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error demoting content', { error: error.message });
      res.status(500).json({ error: 'Failed to demote content' });
    }
  }
});

// Pin content (admin/moderator only)
router.post('/:id/pin', requireOidcAuth(), async (req, res) => {
  try {
    // Check if user has permission to pin
    const isModerator = req.user.roles.includes('admin') || req.user.roles.includes('moderator');
    if (!isModerator) {
      return res.status(403).json({ error: 'Only admins and moderators can pin content' });
    }

    const db = database.getDb();
    const content = await db.get(req.params.id);

    // Update the content to mark as pinned
    content.pinned = true;
    content.pinned_at = new Date().toISOString();
    content.pinned_by = req.user.id;

    await db.insert(content);

    logger.info('Content pinned', {
      contentId: req.params.id,
      pinnedBy: req.user.id
    });

    res.json({ message: 'Content pinned successfully' });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error pinning content', { error: error.message });
      res.status(500).json({ error: 'Failed to pin content' });
    }
  }
});

// Unpin content (admin/moderator only)
router.post('/:id/unpin', requireOidcAuth(), async (req, res) => {
  try {
    // Check if user has permission to unpin
    const isModerator = req.user.roles.includes('admin') || req.user.roles.includes('moderator');
    if (!isModerator) {
      return res.status(403).json({ error: 'Only admins and moderators can unpin content' });
    }

    const db = database.getDb();
    const content = await db.get(req.params.id);

    // Update the content to remove pinned status
    content.pinned = false;
    delete content.pinned_at;
    delete content.pinned_by;

    await db.insert(content);

    logger.info('Content unpinned', {
      contentId: req.params.id,
      unpinnedBy: req.user.id
    });

    res.json({ message: 'Content unpinned successfully' });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error unpinning content', { error: error.message });
      res.status(500).json({ error: 'Failed to unpin content' });
    }
  }
});

// Forum reply schema - different from comments
const replySchema = Joi.object({
  content: Joi.string().required().min(1).max(2000), // Longer replies allowed
  author_name: Joi.string().required().min(1).max(100),
  author_email: Joi.string().email({ tlds: { allow: false } }).optional(), // Allow any TLD including .local
  author_roles: Joi.array().items(Joi.string()).optional(),
  enabled: Joi.boolean().default(true)
});

// Get replies for a specific forum post
router.get('/:id/replies', async (req, res) => {
  try {
    await database.connect();
    const db = database.getDb();

    // Check if the content exists and is a forum post
    const content = await db.get(req.params.id);
    if (content.type !== 'forum') {
      return res.status(400).json({ error: 'Replies only available for forum posts' });
    }


    // Find replies for this forum post
    const result = await db.find({
      selector: {
        type: 'reply',
        content_id: req.params.id
      },
      limit: 1000
    });

    // Sort replies in JavaScript and only show approved/pending
    // Also filter out disabled replies unless user is admin/moderator
    const isUserModerator = req.user && req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('moderator'));

    let replies = result.docs
      .filter(doc => {
        // Only show approved/pending replies
        if (doc.status !== 'approved' && doc.status !== 'pending') return false;

        // Show disabled replies only to moderators
        if (doc.enabled === false && !isUserModerator) return false;

        return true;
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    res.json(replies);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Forum post not found' });
    } else {
      logger.error('Error fetching replies', {
        contentId: req.params.id,
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: 'Failed to fetch replies' });
    }
  }
});

// Add a reply to a forum post
router.post('/:id/replies', async (req, res) => {
  try {
    const { error, value } = replySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    await database.connect();
    const db = database.getDb();

    // Check if the content exists and is a forum post
    const content = await db.get(req.params.id);
    if (content.type !== 'forum') {
      return res.status(400).json({ error: 'Replies only available for forum posts' });
    }


    const reply = {
      type: 'reply',
      content_id: req.params.id,
      content: value.content,
      author_name: value.author_name,
      author_email: value.author_email,
      author_roles: value.author_roles || [],
      status: 'approved', // Forum replies can be auto-approved
      created_at: new Date().toISOString(),
      ip_address: req.ip || req.connection.remoteAddress
    };

    const result = await db.insert(reply);
    reply._id = result.id;
    reply._rev = result.rev;

    logger.info('Reply created', {
      replyId: result.id,
      contentId: req.params.id,
      author: value.author_name
    });

    res.status(201).json(reply);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Forum post not found' });
    } else {
      logger.error('Error creating reply', { error: error.message });
      res.status(500).json({ error: 'Failed to create reply' });
    }
  }
});

// Update a reply (for enabling/disabling)
router.put('/replies/:replyId', requireOidcAuth(), async (req, res) => {
  try {
    const { error, value } = replySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    await database.connect();
    const db = database.getDb();
    const reply = await db.get(req.params.replyId);

    if (reply.type !== 'reply') {
      return res.status(404).json({ error: 'Reply not found' });
    }

    // Check if user can edit this reply (author or moderator)
    const isAuthor = reply.author_name === req.user.name || reply.author_email === req.user.email;
    const isModerator = req.user.roles.includes('admin') || req.user.roles.includes('moderator');

    if (!isAuthor && !isModerator) {
      return res.status(403).json({ error: 'Cannot edit reply by another user' });
    }

    const updatedReply = {
      ...reply,
      ...value,
      updated_at: new Date().toISOString()
    };

    const result = await db.insert(updatedReply);
    updatedReply._rev = result.rev;

    logger.info('Reply updated', {
      replyId: updatedReply._id,
      userId: req.user.id,
      enabled: updatedReply.enabled
    });

    res.json(updatedReply);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Reply not found' });
    } else {
      logger.error('Error updating reply', { id: req.params.replyId, error: error.message });
      res.status(500).json({ error: 'Failed to update reply' });
    }
  }
});

// Get user statistics (post count, join date, etc.)
router.get('/user/:identifier/stats', async (req, res) => {
  try {
    await database.connect();
    const db = database.getDb();

    const identifier = req.params.identifier;

    // Count posts by this user (both blog and forum posts)
    const postResult = await db.find({
      selector: {
        type: { $in: ['blog', 'forum'] },
        $or: [
          { 'author.name': identifier },
          { 'author_name': identifier }
        ]
      }
    });

    // Separate forum and blog counts
    const forumPosts = postResult.docs.filter(doc => doc.type === 'forum');
    const blogPosts = postResult.docs.filter(doc => doc.type === 'blog');

    // Count replies by this user
    const replyResult = await db.find({
      selector: {
        type: 'reply',
        author_name: identifier
      }
    });

    // Count comments by this user
    const commentResult = await db.find({
      selector: {
        type: 'comment',
        author_name: identifier
      }
    });

    // Find the earliest content created by this user to estimate join date
    const allUserContent = [...postResult.docs, ...replyResult.docs, ...commentResult.docs];
    let joinDate = null;
    if (allUserContent.length > 0) {
      const earliestContent = allUserContent.reduce((earliest, current) => {
        return new Date(current.created_at) < new Date(earliest.created_at) ? current : earliest;
      });
      joinDate = earliestContent.created_at;
    }

    const stats = {
      posts: postResult.docs.length,
      forum_posts: forumPosts.length,
      blog_posts: blogPosts.length,
      replies: replyResult.docs.length,
      comments: commentResult.docs.length,
      total_activity: postResult.docs.length + replyResult.docs.length + commentResult.docs.length,
      join_date: joinDate
    };

    res.json(stats);
  } catch (error) {
    logger.error('Error fetching user stats', { identifier: req.params.identifier, error: error.message });
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
});

module.exports = router;
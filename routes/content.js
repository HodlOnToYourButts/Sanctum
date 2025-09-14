const express = require('express');
const Joi = require('joi');
const database = require('../lib/database');
const { requireAuth, requireRole } = require('../lib/auth');
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

const router = express.Router();

const pageSchema = Joi.object({
  type: Joi.string().valid('page').required(),
  title: Joi.string().required(),
  body: Joi.string().required(),
  status: Joi.string().valid('draft', 'published', 'archived').default('published'),
  promotable: Joi.boolean().default(false)
});

const blogSchema = Joi.object({
  type: Joi.string().valid('blog').required(),
  title: Joi.string().required(),
  body: Joi.string().required(),
  tags: Joi.array().items(Joi.string()).default([]),
  status: Joi.string().valid('draft', 'published', 'archived').default('published'),
  allow_comments: Joi.boolean().default(true),
  promotable: Joi.boolean().default(true) // Blogs are promotable by default
});

const contentSchema = Joi.alternatives().try(pageSchema, blogSchema);

router.get('/', async (req, res) => {
  try {
    await database.connect(); // Ensure database connection
    const db = database.getDb();
    const { type, status, limit = 20, skip = 0 } = req.query;

    // Use Mango query instead of views for simplicity
    const selector = {
      $or: [
        { type: 'page' },
        { type: 'blog' }
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

    const items = result.docs.map(doc => ({
      _id: doc._id,
      type: doc.type,
      title: doc.title,
      body: doc.body,
      status: doc.status,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      author_name: doc.author?.name,
      author_id: doc.author?.id,
      tags: doc.tags || [],
      allow_comments: doc.allow_comments
    }));

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
    const { type, sort = 'new', limit = 20, skip = 0 } = req.query;

    // Simplified selector - just get all content and filter in JavaScript
    const selector = {
      $or: [
        { type: 'page' },
        { type: 'blog' }
      ]
    };

    const result = await db.find({
      selector,
      limit: 100 // Get more docs to filter from
    });

    // Filter and process results
    let items = result.docs
      .filter(doc => {
        // Only include published content
        if (doc.status !== 'published') return false;

        // Only include promotable content (blogs are promotable by default)
        if (doc.type === 'blog') return doc.promotable !== false;
        if (doc.type === 'page') return doc.promotable === true;

        return false;
      })
      .filter(doc => {
        // Filter by type if specified
        if (type && type !== 'all') {
          return doc.type === type;
        }
        return true;
      })
      .map(doc => ({
        _id: doc._id,
        type: doc.type,
        title: doc.title,
        body: doc.body ? (doc.body.substring(0, 300) + (doc.body.length > 300 ? '...' : '')) : '',
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        author_name: doc.author?.name,
        author_id: doc.author?.id,
        tags: doc.tags || [],
        votes: doc.votes || { up: 0, down: 0, score: 0 },
        allow_comments: doc.allow_comments
      }));

    // Sort items
    if (sort === 'top') {
      items.sort((a, b) => b.votes.score - a.votes.score);
    } else {
      // Sort by newest first (created_at)
      items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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

    res.json(content);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error fetching content', { id: req.params.id, error: error.message });
      res.status(500).json({ error: 'Failed to fetch content' });
    }
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { error, value } = contentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    await database.connect(); // Ensure database connection
    const db = database.getDb();
    const content = {
      ...value,
      author: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
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

router.put('/:id', requireAuth, async (req, res) => {
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

    if (existingContent.author.id !== req.user.id && !(req.user.currentRoles && req.user.currentRoles.includes('admin'))) {
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

router.delete('/:id', requireAuth, async (req, res) => {
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
  author_email: Joi.string().email().optional()
});

// Get comments for a specific blog post
router.get('/:id/comments', async (req, res) => {
  try {
    const db = database.getDb();

    // First check if the content exists and is a blog
    const content = await db.get(req.params.id);
    if (content.type !== 'blog') {
      return res.status(400).json({ error: 'Comments only available for blog posts' });
    }

    if (!content.allow_comments) {
      return res.status(403).json({ error: 'Comments are disabled for this post' });
    }

    // Find comments for this content
    const result = await db.find({
      selector: {
        type: 'comment',
        content_id: req.params.id
      },
      sort: [{ 'created_at': 'asc' }]
    });

    const comments = result.docs.map(doc => ({
      _id: doc._id,
      content: doc.content,
      author_name: doc.author_name,
      created_at: doc.created_at,
      status: doc.status
    }));

    res.json(comments);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error fetching comments', { id: req.params.id, error: error.message });
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

    const db = database.getDb();

    // Check if the content exists and is a blog
    const content = await db.get(req.params.id);
    if (content.type !== 'blog') {
      return res.status(400).json({ error: 'Comments only available for blog posts' });
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
router.put('/:id/comments/:commentId', requireRole('admin'), async (req, res) => {
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

// Voting system
router.post('/:id/vote', requireAuth, async (req, res) => {
  try {
    const { vote } = req.body; // 'up', 'down', or 'remove'

    if (!['up', 'down', 'remove'].includes(vote)) {
      return res.status(400).json({ error: 'Invalid vote type' });
    }

    await database.connect();
    const db = database.getDb();
    const content = await db.get(req.params.id);

    if (!content.type || !['page', 'blog'].includes(content.type)) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Initialize voting fields if they don't exist
    if (!content.votes) {
      content.votes = { up: 0, down: 0, score: 0 };
    }
    if (!content.voter_list) {
      content.voter_list = [];
    }

    const userId = req.user.id;
    const existingVote = content.voter_list.find(v => v.user_id === userId);

    // Remove existing vote if any
    if (existingVote) {
      if (existingVote.type === 'up') {
        content.votes.up--;
      } else if (existingVote.type === 'down') {
        content.votes.down--;
      }
      content.voter_list = content.voter_list.filter(v => v.user_id !== userId);
    }

    // Add new vote if not removing
    if (vote !== 'remove') {
      content.voter_list.push({
        user_id: userId,
        type: vote,
        timestamp: new Date().toISOString()
      });

      if (vote === 'up') {
        content.votes.up++;
      } else if (vote === 'down') {
        content.votes.down++;
      }
    }

    // Calculate score
    content.votes.score = content.votes.up - content.votes.down;
    content.updated_at = new Date().toISOString();

    await db.insert(content);

    res.json({
      votes: content.votes,
      userVote: vote === 'remove' ? null : vote
    });

    logger.info('Content voted', {
      contentId: req.params.id,
      userId: req.user.id,
      voteType: vote,
      newScore: content.votes.score
    });

  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Content not found' });
    } else {
      logger.error('Error voting on content', { error: error.message });
      res.status(500).json({ error: 'Failed to vote' });
    }
  }
});

module.exports = router;
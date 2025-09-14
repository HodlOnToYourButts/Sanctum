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

const contentSchema = Joi.object({
  title: Joi.string().required(),
  content: Joi.string().required(),
  status: Joi.string().valid('draft', 'published', 'archived').default('draft'),
  tags: Joi.array().items(Joi.string()).default([]),
  metadata: Joi.object().default({})
});

router.get('/', async (req, res) => {
  try {
    const db = database.getDb();
    const { type = 'page', status, limit = 20, skip = 0 } = req.query;

    let key = type;
    if (status) {
      key = [status];
    }

    const viewName = status ? 'by_status' : 'by_type';
    const result = await db.view('content', viewName, {
      key,
      include_docs: true,
      limit: parseInt(limit),
      skip: parseInt(skip),
      descending: true
    });

    res.json({
      items: result.rows.map(row => ({
        id: row.doc._id,
        title: row.doc.title,
        status: row.doc.status,
        created_at: row.doc.created_at,
        updated_at: row.doc.updated_at,
        author: row.doc.author,
        tags: row.doc.tags
      })),
      total: result.total_rows,
      offset: result.offset
    });
  } catch (error) {
    logger.error('Error fetching content', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch content' });
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

    const db = database.getDb();
    const content = {
      type: 'page',
      ...value,
      author: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const result = await db.insert(content);
    content._id = result.id;
    content._rev = result.rev;

    logger.info('Content created', {
      contentId: content._id,
      authorId: req.user._id,
      title: content.title
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

    if (existingContent.author.id !== req.user._id && !req.user.roles.includes('admin')) {
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
      authorId: req.user._id,
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

    if (content.author.id !== req.user._id && !req.user.roles.includes('admin')) {
      return res.status(403).json({ error: 'Cannot delete content by another author' });
    }

    await db.destroy(req.params.id, content._rev);

    logger.info('Content deleted', {
      contentId: req.params.id,
      authorId: req.user._id,
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

module.exports = router;
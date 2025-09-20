# Sanctum - Cyberpunk Terminal CMS

A retro-futuristic content management system with a terminal-inspired interface, featuring blogs and forums in a cyberpunk aesthetic.

## Features

- **Terminal UI Design** - Monospace fonts, green-on-black color scheme, and ASCII art styling
- **Blog Platform** - Create and manage blog posts with rich content
- **Forum System** - Discussion threads with threaded conversations
- **User Authentication** - OAuth2/OIDC integration with role-based permissions
- **Interactive Voting** - Upvote/downvote system for content engagement
- **Real-time Comments** - Threaded discussions with moderation capabilities
- **Admin Dashboard** - Content management, user administration, and system controls
- **Responsive Design** - Terminal aesthetic that works across devices
- **Security Focused** - Rate limiting, input validation, and XSS protection

## Tech Stack

- **Backend**: Node.js with Express
- **Database**: CouchDB with optimized views
- **Frontend**: Vanilla JavaScript with terminal styling
- **Authentication**: OAuth2/OIDC providers
- **Security**: Custom rate limiting and validation utilities

## Quick Start

```bash
# Using Docker Compose
docker-compose up -d

# Using Podman Compose
podman-compose up -d
```

Navigate to `http://localhost:8080` to access the terminal interface.

## Configuration

Create a `.env` file with your configuration:

```bash
COUCHDB_URL=http://couchdb:5984
COUCHDB_USERNAME=admin
COUCHDB_PASSWORD=password
OAUTH2_CLIENT_ID=your_client_id
OAUTH2_CLIENT_SECRET=your_client_secret
OAUTH2_REDIRECT_URI=http://localhost:8080/callback
SESSION_SECRET=your_session_secret
```

## Architecture

- **Content Types**: Blog posts and forum threads with extensible design
- **Authorization**: Role-based access control with admin, moderator, and user roles
- **Database Views**: Optimized CouchDB map-reduce functions for performance
- **Security Layer**: Rate limiting, input sanitization, and XSS protection

## Development

```bash
# Local development without containers
npm install
npm start
```

---

*Enter the digital underground. Welcome to Sanctum.*
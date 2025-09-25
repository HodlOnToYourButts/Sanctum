# Sanctum - Development Setup

## Quick Start with Docker Compose

1. **Clone and start the development environment:**
   ```bash
   git clone <repository-url>
   cd Sanctum
   docker-compose up --build
   ```

   > **Note**: Use `--build` the first time or when dependencies change

2. **Access the application:**
   - App: http://localhost:8080
   - CouchDB Admin: http://localhost:5984/_utils (admin/password)

3. **Development Features:**
   - **Hot reload**: Changes to code automatically restart the server
   - **Bypass authentication**: No OIDC required for development
   - **Test users**: Pre-configured users with different roles

## Test Users

When `DEVELOPMENT_MODE=true` AND `BYPASS_AUTH=true`, you can login as any of these test users:

| Username     | Password     | Roles        | Description |
|-------------|-------------|-------------|-------------|
| admin       | admin       | admin       | Full system access |
| moderator   | moderator   | moderator   | Content moderation |
| contributor | contributor | contributor | Can create content |
| user        | user        | user        | Basic user access |

## Development Environment Variables

Copy `.env.development` to `.env` or set these variables:

```bash
NODE_ENV=development
DEVELOPMENT_MODE=true
SESSION_SECRET=dev-secret-key
INSTANCE_ID=dev-local
COUCHDB_URL=http://localhost:5984
COUCHDB_DATABASE=sanctum_dev
```

## Local Development (without Docker)

If you prefer to run without Docker:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start CouchDB:**
   ```bash
   docker run -d --name couchdb -p 5984:5984 \
     -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password \
     couchdb:3.3
   ```

3. **Copy environment file:**
   ```bash
   cp .env.development .env
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

## Troubleshooting

### Docker: "nodemon: not found"
If you see this error, rebuild the containers:
```bash
docker-compose down
docker-compose up --build
```

### CouchDB Connection Issues
Make sure CouchDB is running and accessible:
```bash
curl http://localhost:5984
```

## Production Deployment

For production, set `DEVELOPMENT_MODE=false` and `BYPASS_AUTH=false` (or remove them) and configure proper OIDC settings:

```bash
NODE_ENV=production
DEVELOPMENT_MODE=false
ISSUER=https://your-oidc-provider.com
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
CALLBACK_URL=https://your-domain.com/callback
```

## Features in Development Mode

- 🔓 **Authentication Bypass**: Skip OIDC setup for quick development
- 👥 **Test Users**: Ready-to-use accounts with different permission levels
- 🔄 **Hot Reload**: Automatic server restart on code changes
- 🐳 **Docker Integration**: Consistent development environment
- 📊 **CouchDB UI**: Web interface for database management

## Database

The development setup uses CouchDB with:
- **URL**: http://localhost:5984
- **Database**: sanctum_dev
- **Admin**: admin/password

The database will be automatically created when the app starts.
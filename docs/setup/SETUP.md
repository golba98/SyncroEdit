# Setup Guide for Developers

This guide will help you set up SynchroEdit for local development with proper security configurations.

## Prerequisites

- Node.js 18 or higher
- MongoDB (local installation or cloud instance)
- Git

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/synchroedit.git
cd synchroedit
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

#### Create Your Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

#### Generate Secure Secrets

**Generate JWT Secret:**

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output and set it as `JWT_SECRET` in your `.env` file.

**Generate RSA Key Pair (Recommended for Production):**

```bash
# Generate private key
ssh-keygen -t rsa -b 2048 -m PEM -f jwtRS256.key -N ""

# Extract public key
openssl rsa -in jwtRS256.key -pubout -outform PEM -out jwtRS256.key.pub
```

Then update your `.env` file:

```bash
# Read the private key
cat jwtRS256.key

# Read the public key
cat jwtRS256.key.pub
```

Format them in your `.env` file as:

```env
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
your_private_key_content_here
-----END PRIVATE KEY-----"

JWT_PUBLIC_KEYS={"v1":"-----BEGIN PUBLIC KEY-----\nyour_public_key_content_here\n-----END PUBLIC KEY-----"}
```

#### Configure MongoDB

Set your MongoDB connection string:

```env
MONGODB_URI=mongodb://localhost:27017/synchroedit
```

Or use MongoDB Atlas:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>
```

#### Email Configuration (Optional)

If you want to enable email verification features:

```env
ENABLE_EMAIL_VERIFICATION=true
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
```

### 4. Start Development Server

```bash
npm start
```

The application will be available at `http://localhost:3000`

## Docker Setup

### For Local Docker Development

1. Copy the Docker environment example:

```bash
cp .env.docker.example .env
```

2. Generate and configure secrets as described above

3. Start the containers:

```bash
docker-compose up -d
```

4. View logs:

```bash
docker-compose logs -f
```

## Security Best Practices

### ⚠️ Critical Security Rules

1. **NEVER commit `.env` files to version control**
   - All `.env` files are already excluded in `.gitignore`
   - Always use `.env.example` as a template

2. **Use strong, unique secrets for production**
   - Never use default or example secrets in production
   - Rotate secrets regularly

3. **Generate new RSA keys for each environment**
   - Development keys should differ from production
   - Store production keys securely (use secret managers like AWS Secrets Manager, Azure Key Vault, etc.)

4. **Validate environment variables on startup**
   - The application should fail to start if critical variables are missing
   - Use strong validation for secret complexity

### What's Safe to Commit

✅ `.env.example` - Template with placeholders
✅ `.env.docker.example` - Docker template
✅ Configuration files without secrets
✅ Code and documentation

### What Should NEVER be Committed

❌ `.env` - Your actual environment file
❌ `.env.local`, `.env.production` - Any environment files
❌ `jwtRS256.key`, `jwtRS256.key.pub` - RSA key files
❌ Any files containing passwords, API keys, or secrets

## Testing

Run the test suite:

```bash
npm test
```

Run end-to-end tests:

```bash
npm run test:e2e
```

## Production Deployment

For production deployment:

1. Use environment variables provided by your hosting platform
2. Enable all security features (HTTPS, secure cookies, CSRF protection)
3. Set `NODE_ENV=production`
4. Use managed database services with authentication
5. Implement proper logging and monitoring
6. Enable rate limiting and DDoS protection
7. Regular security audits and dependency updates

## Troubleshooting

### MongoDB Connection Issues

- Verify MongoDB is running: `mongod --version`
- Check connection string format
- Ensure network access is allowed (for cloud databases)

### JWT Token Issues

- Verify `JWT_SECRET` is set and is a strong random string
- Check that RSA keys are properly formatted in `.env`
- Ensure `JWT_CURRENT_KID` matches a key in `JWT_PUBLIC_KEYS`

### Port Already in Use

```bash
# Find and kill process on port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -ti:3000 | xargs kill -9
```

## Getting Help

- Check existing issues: [GitHub Issues](https://github.com/yourusername/synchroedit/issues)
- Read the [Security Documentation](./mds/SECURITY.md)
- Contact: your-email@example.com

## License

ISC License - See LICENSE file for details

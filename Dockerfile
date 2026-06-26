# Step 1: Build & Compile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for compilation)
RUN npm ci

# Copy source code
COPY src ./src

# Compile TypeScript to JavaScript
RUN npm run compile

# Prune node_modules to keep only production dependencies
RUN npm prune --production

# Step 2: Runtime Image
FROM node:18-alpine

WORKDIR /app

# Copy production dependencies and compiled out files
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/out ./out

# Set default environment variables
ENV PORT=9099
ENV NODE_ENV=production

# Expose the proxy server port
EXPOSE 9099

# Launch the standalone reverse proxy
CMD ["node", "out/proxy_launcher.js"]

# API Forge backend — production Docker image
FROM node:20-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy rest of the app
COPY . .

# JSON-file stores (forgeKeys.json, users.json, conversations.json) live
# here — mount a volume to this path in production so data survives
# container restarts (see docker-compose.yml / AWS notes below).
RUN mkdir -p /app/data

ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]

FROM node:20-alpine

# Production runtime: among other things, Express omits stack traces from error
# responses. The server also installs an explicit generic error handler.
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY daily-ui/package*.json ./daily-ui/
RUN npm ci --prefix daily-ui

COPY . .
RUN npm run build --prefix daily-ui

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY logger.js ./
COPY daily.html ./
COPY --from=build /app/dist ./dist
COPY tests ./tests
COPY daily-ui/package.json ./daily-ui/package.json
COPY daily-ui/src ./daily-ui/src
COPY daily ./daily
COPY projects ./projects
COPY resources ./resources
COPY areas ./areas
COPY people ./people
COPY config.json ./config.json

RUN mkdir -p /app/log

EXPOSE 8008
CMD ["node", "server.js"]

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY logger.js ./
COPY daily.html ./
COPY --from=build /app/dist ./dist
COPY tests ./tests
COPY src/package.json ./src/package.json
COPY src ./src
COPY daily ./daily
COPY projects ./projects
COPY resources ./resources
COPY areas ./areas
COPY people ./people
COPY config.json ./config.json

RUN mkdir -p /app/log

EXPOSE 8008
CMD ["node", "server.js"]

FROM mcr.microsoft.com/playwright:v1.54.2-noble AS test
WORKDIR /app
ENV CI=1

COPY package*.json ./
RUN npm install
RUN npm install --no-save @playwright/test@1.54.2

COPY playwright.config.js ./
COPY tests ./tests
COPY server.js ./
COPY logger.js ./
COPY daily.html ./
COPY src/package.json ./src/package.json
COPY src ./src
COPY --from=build /app/dist ./dist
COPY daily ./daily
COPY projects ./projects
COPY resources ./resources
COPY areas ./areas
COPY people ./people
COPY config.json ./config.json

CMD ["sh", "-lc", "npm test && npm run test:e2e"]

FROM node:22-alpine AS build

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/src/hoi4/countries.json ./dist/src/hoi4/countries.json

EXPOSE 3001
CMD ["node", "dist/src/main.js"]

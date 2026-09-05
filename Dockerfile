FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/src/types ./src/types
ENV HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/data/repobuzz.sqlite
USER node
EXPOSE 3001
CMD ["npm", "start"]

FROM node:22 AS sdk-builder
WORKDIR /w
COPY auth-sdk/package.json auth-sdk/vite.config.js ./auth-sdk/
COPY auth-sdk/src ./auth-sdk/src
WORKDIR /w/auth-sdk
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
COPY api-gateway/package.json ./
RUN npm install --omit=dev
COPY api-gateway/src ./src
COPY --from=sdk-builder /w/auth-sdk/dist ./public/sdk/v1
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]

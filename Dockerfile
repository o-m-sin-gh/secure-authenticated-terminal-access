FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
EXPOSE 8080
USER node
CMD ["node", "src/multi-user-gateway.js"]

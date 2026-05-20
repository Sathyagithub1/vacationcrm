FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ws-server ./src/ws-server
COPY src/lib/redis* ./src/lib/
COPY tsconfig.json ./

EXPOSE 3001

CMD ["npx", "tsx", "src/ws-server/index.ts"]

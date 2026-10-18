FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY lib/ ./lib/
COPY public/ ./public/
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["node", "server.mjs"]

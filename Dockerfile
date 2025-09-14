FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN addgroup -g 1001 -S nodejs && \
    adduser -S phoenix -u 1001 -G nodejs

USER phoenix

EXPOSE 8080

CMD ["npm", "start"]
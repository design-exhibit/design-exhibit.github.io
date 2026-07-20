FROM node:20.19-alpine

WORKDIR /app

ENV NODE_ENV=production \
    TCB_ENV=github-d2gr7dltobfb415cc

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js order-core.cjs ./

EXPOSE 9000

CMD ["node", "index.js"]

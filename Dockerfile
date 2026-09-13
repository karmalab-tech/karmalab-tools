# KarmaLab Tools — production image for fly.io
#
# Two stages: build the Vite app, then run the tiny Node server that serves
# dist/ and proxies Replicate. The runtime stage needs no node_modules — the
# server uses only Node core modules.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]

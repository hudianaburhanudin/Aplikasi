FROM node:22-alpine
ENV NODE_ENV=production DB_FILE=/data/sekolah.db PORT=3000
WORKDIR /app
COPY package.json ./
COPY *.js ./
COPY public ./public
RUN rm -f server.test.js && mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server.js"]

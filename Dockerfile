ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

COPY --chown=node:node server.js index.html ./
COPY --chown=node:node css ./css
COPY --chown=node:node js ./js

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

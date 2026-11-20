# Imagen de la landing de ObraCota (Next.js en modo standalone).
# Se construye desde la raíz del repositorio: docker compose up -d --build

FROM node:24-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS compilacion
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# El dominio público queda fijado al compilar (metadatos y enlaces absolutos).
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3200
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_PANEL_URL
ENV NEXT_PUBLIC_PANEL_URL=$NEXT_PUBLIC_PANEL_URL
ENV NEXT_OUTPUT=standalone
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS ejecucion
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# El servidor corre con el usuario sin privilegios que trae la imagen.
COPY --from=compilacion --chown=node:node /app/.next/standalone ./
COPY --from=compilacion --chown=node:node /app/.next/static ./.next/static
COPY --from=compilacion --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]

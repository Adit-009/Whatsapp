# ── Stage 1: Build the Go WhatsApp service ──
FROM golang:1.25-bookworm AS go-builder

WORKDIR /build
COPY whatsapp-service/ .
RUN go mod download
RUN CGO_ENABLED=1 GOOS=linux go build -tags netgo -ldflags '-s -w' -o whatsapp-service .

# ── Stage 2: Final runtime image with Node.js + Go binary ──
FROM node:22-bookworm-slim

# Install required C libraries for the Go binary (CGO/SQLite)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libc6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Node.js app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY config/ ./config/
COPY controllers/ ./controllers/
COPY models/ ./models/
COPY public/ ./public/
COPY routes/ ./routes/
COPY services/ ./services/
COPY views/ ./views/

# Copy the compiled Go binary
COPY --from=go-builder /build/whatsapp-service ./whatsapp-service/whatsapp-service

# Copy the startup script
COPY start.sh ./start.sh
RUN sed -i 's/\r$//' ./start.sh && chmod +x ./start.sh

EXPOSE 3000 8080

CMD ["./start.sh"]

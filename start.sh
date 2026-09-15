#!/bin/bash
set -e

echo "Starting WhatsApp Go service..."
cd /app/whatsapp-service
./whatsapp-service &
GO_PID=$!

echo "Starting Node.js app..."
cd /app
node index.js &
NODE_PID=$!

# Forward termination signals to both processes
trap "kill $GO_PID $NODE_PID; wait $GO_PID $NODE_PID; exit 0" SIGTERM SIGINT

# Wait for either process to exit
wait -n $GO_PID $NODE_PID
EXIT_CODE=$?

# If one exits, stop the other
kill $GO_PID $NODE_PID 2>/dev/null || true
wait $GO_PID $NODE_PID 2>/dev/null || true

exit $EXIT_CODE

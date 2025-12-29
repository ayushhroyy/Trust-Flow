#!/bin/bash

echo "🚀 Starting Securify Server..."
echo "📂 Serving from: $(pwd)"
echo "🌐 Server URL: http://localhost:8000"
echo "⏹️  Press Ctrl+C to stop the server"
echo ""

python3 -m http.server 8000

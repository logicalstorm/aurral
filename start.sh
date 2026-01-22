#!/bin/bash

if [ ! -d "frontend/dist" ]; then
  echo "Building frontend..."
  npm run build
fi

echo "Starting Aurral..."
node server.js

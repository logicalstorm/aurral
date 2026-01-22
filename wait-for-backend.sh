#!/bin/bash
echo "Waiting for backend to be ready..."
until curl -s http://localhost:3001/api/health > /dev/null 2>&1; do
  sleep 1
done
echo "Backend is ready!"

#!/bin/bash
# Deploy FLC to Netlify via API
# Usage: ./deploy.sh <NETLIFY_AUTH_TOKEN> <SITE_ID_OR_NAME>

set -e

TOKEN="$1"
SITE="$2"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building and deploying FLC to Netlify..."

# Create temporary build archive
cd "$DIR"
rm -rf dist
mkdir -p dist
cp -r public/* dist/
cp -r netlify/functions dist/

# Add netlify.toml to dist root
cp netlify.toml dist/

cd dist
zip -r ../deploy.zip . > /dev/null

echo "Uploading to Netlify..."

# Deploy via API
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @../deploy.zip \
  "https://api.netlify.com/api/v1/sites/$SITE/deploys" \
  -w "\n%{http_code}")

rm -f ../deploy.zip

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "Deployed successfully!"
    echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'URL: {d.get(\"ssl_url\",\"N/A\")}')" 2>/dev/null || echo "$BODY"
else
    echo "Deploy failed with code $HTTP_CODE"
    echo "$BODY"
    exit 1
fi

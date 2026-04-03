#!/bin/bash
# Publish copilot-agent to npm
# Usage: ./publish.sh <OTP_CODE>
# Get OTP from your authenticator app

if [ -z "$1" ]; then
  echo "Usage: ./publish.sh <OTP_CODE>"
  echo "Get OTP from your npm 2FA authenticator app"
  exit 1
fi

npm publish --access public --otp="$1"

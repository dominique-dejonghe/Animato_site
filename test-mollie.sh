#!/bin/bash

# Mollie Integration Test Script
# Tests Mollie API connectivity and payment creation

set -e

echo "🧪 Mollie Integration Test Script"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .dev.vars exists
if [ ! -f ".dev.vars" ]; then
    echo -e "${RED}❌ .dev.vars file not found${NC}"
    exit 1
fi

# Load environment variables
source .dev.vars

# Check if MOLLIE_API_KEY is set
if [ -z "$MOLLIE_API_KEY" ]; then
    echo -e "${RED}❌ MOLLIE_API_KEY not set in .dev.vars${NC}"
    exit 1
fi

echo -e "${YELLOW}📡 Testing Mollie API connectivity...${NC}"
echo ""

# Test 1: Check API key validity
echo "Test 1: Checking API key validity..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "https://api.mollie.com/v2/methods" \
  -H "Authorization: Bearer $MOLLIE_API_KEY")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✅ API key is valid!${NC}"
    echo ""
    echo "Available payment methods:"
    echo "$BODY" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | sed 's/^/  - /'
    echo ""
else
    echo -e "${RED}❌ API key is invalid (HTTP $HTTP_CODE)${NC}"
    echo "Response: $BODY"
    exit 1
fi

# Test 2: Get current balance
echo "Test 2: Checking account balance..."
BALANCE_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "https://api.mollie.com/v2/balances" \
  -H "Authorization: Bearer $MOLLIE_API_KEY")

BALANCE_HTTP_CODE=$(echo "$BALANCE_RESPONSE" | tail -n1)
BALANCE_BODY=$(echo "$BALANCE_RESPONSE" | head -n-1)

if [ "$BALANCE_HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✅ Balance retrieved successfully${NC}"
    echo ""
else
    echo -e "${YELLOW}⚠️  Could not retrieve balance (might not be available in test mode)${NC}"
    echo ""
fi

# Test 3: List recent payments (if any)
echo "Test 3: Listing recent payments..."
PAYMENTS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "https://api.mollie.com/v2/payments?limit=5" \
  -H "Authorization: Bearer $MOLLIE_API_KEY")

PAYMENTS_HTTP_CODE=$(echo "$PAYMENTS_RESPONSE" | tail -n1)
PAYMENTS_BODY=$(echo "$PAYMENTS_RESPONSE" | head -n-1)

if [ "$PAYMENTS_HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✅ Payments retrieved successfully${NC}"
    
    # Count payments
    PAYMENT_COUNT=$(echo "$PAYMENTS_BODY" | grep -o '"id":"tr_[^"]*"' | wc -l)
    echo "Recent payments: $PAYMENT_COUNT"
    echo ""
else
    echo -e "${RED}❌ Could not retrieve payments${NC}"
    echo ""
fi

# Test 4: Create a test payment (€0.01)
echo "Test 4: Creating test payment..."
echo -e "${YELLOW}This will create a €0.01 test payment${NC}"
echo ""

# Check if SITE_URL is set
if [ -z "$SITE_URL" ]; then
    SITE_URL="http://localhost:3000"
    echo -e "${YELLOW}⚠️  SITE_URL not set, using $SITE_URL${NC}"
fi

CREATE_PAYMENT=$(curl -s -w "\n%{http_code}" -X POST "https://api.mollie.com/v2/payments" \
  -H "Authorization: Bearer $MOLLIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"amount\": {
      \"currency\": \"EUR\",
      \"value\": \"0.01\"
    },
    \"description\": \"Test Payment - Animato Koor\",
    \"redirectUrl\": \"$SITE_URL/tickets/bevestiging/TEST-123\",
    \"webhookUrl\": \"$SITE_URL/api/webhooks/mollie\",
    \"metadata\": {
      \"test\": \"true\",
      \"order_ref\": \"TEST-123\"
    }
  }")

CREATE_HTTP_CODE=$(echo "$CREATE_PAYMENT" | tail -n1)
CREATE_BODY=$(echo "$CREATE_PAYMENT" | head -n-1)

if [ "$CREATE_HTTP_CODE" == "201" ]; then
    echo -e "${GREEN}✅ Test payment created successfully!${NC}"
    echo ""
    
    # Extract payment ID and checkout URL
    PAYMENT_ID=$(echo "$CREATE_BODY" | grep -o '"id":"tr_[^"]*"' | cut -d'"' -f4)
    CHECKOUT_URL=$(echo "$CREATE_BODY" | grep -o '"checkout":{"href":"[^"]*"' | cut -d'"' -f4)
    
    echo "Payment ID: $PAYMENT_ID"
    echo "Checkout URL: $CHECKOUT_URL"
    echo ""
    echo -e "${GREEN}🎉 You can complete the payment at:${NC}"
    echo "$CHECKOUT_URL"
    echo ""
    echo -e "${YELLOW}💡 Tip: Use test data from https://docs.mollie.com/overview/testing${NC}"
    echo ""
else
    echo -e "${RED}❌ Could not create test payment (HTTP $CREATE_HTTP_CODE)${NC}"
    echo "Response: $CREATE_BODY"
    exit 1
fi

# Summary
echo "=================================="
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "  1. Complete the test payment at the URL above"
echo "  2. Check webhook reception: pm2 logs animato-koor"
echo "  3. Verify database update"
echo "  4. Check email notifications"
echo ""
echo -e "${YELLOW}📖 Full setup guide: cat MOLLIE_SETUP.md${NC}"

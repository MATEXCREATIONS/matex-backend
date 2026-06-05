#!/usr/bin/env bash
# Matex Backend API Comprehensive Test Suite
# Tests all endpoints with curl commands

BASE_URL="http://localhost:5001"
ADMIN_PASSWORD="your-admin-password-here"
TEST_EMAIL="test@example.com"
TEST_ORDER_ID="MATEX-2024-001"

echo "=================================="
echo "Matex Backend API Test Suite"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo -e "${YELLOW}TEST 1: Health Check${NC}"
curl -s "$BASE_URL/api/health" | jq .
echo ""

# Test 2: Admin Login
echo -e "${YELLOW}TEST 2: Admin Login${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\": \"$ADMIN_PASSWORD\"}")
echo "$LOGIN_RESPONSE" | jq .
ADMIN_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')
echo "Admin Token: $ADMIN_TOKEN"
echo ""

# Test 3: Admin Validate Token
echo -e "${YELLOW}TEST 3: Admin Validate Token${NC}"
if [ -n "$ADMIN_TOKEN" ]; then
  curl -s -X GET "$BASE_URL/api/admin/validate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
else
  echo -e "${RED}SKIPPED: No admin token${NC}"
fi
echo ""

# Test 4: Fetch Admin Orders
echo -e "${YELLOW}TEST 4: Fetch Admin Orders${NC}"
if [ -n "$ADMIN_TOKEN" ]; then
  curl -s -X GET "$BASE_URL/api/admin/orders" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
else
  echo -e "${RED}SKIPPED: No admin token${NC}"
fi
echo ""

# Test 5: Submit Review
echo -e "${YELLOW}TEST 5: Submit Review${NC}"
REVIEW_RESPONSE=$(curl -s -X POST "$BASE_URL/api/reviews" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test Customer",
    "company": "Test Company",
    "rating": 5,
    "message": "Great service!"
  }')
echo "$REVIEW_RESPONSE" | jq .
REVIEW_ID=$(echo "$REVIEW_RESPONSE" | jq -r '.review.id // empty')
echo "Review ID: $REVIEW_ID"
echo ""

# Test 6: Get Approved Reviews (Public)
echo -e "${YELLOW}TEST 6: Get Approved Reviews${NC}"
curl -s -X GET "$BASE_URL/api/reviews" | jq .
echo ""

# Test 7: Get Admin Reviews
echo -e "${YELLOW}TEST 7: Get Admin Reviews${NC}"
if [ -n "$ADMIN_TOKEN" ]; then
  curl -s -X GET "$BASE_URL/api/admin/reviews" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
else
  echo -e "${RED}SKIPPED: No admin token${NC}"
fi
echo ""

# Test 8: Approve Review
echo -e "${YELLOW}TEST 8: Approve Review${NC}"
if [ -n "$ADMIN_TOKEN" ] && [ -n "$REVIEW_ID" ]; then
  curl -s -X PUT "$BASE_URL/api/admin/reviews/$REVIEW_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status": "Approved"}' | jq .
else
  echo -e "${RED}SKIPPED: No admin token or review ID${NC}"
fi
echo ""

# Test 9: Submit Order Brief
echo -e "${YELLOW}TEST 9: Submit Order Brief${NC}"
BRIEF_RESPONSE=$(curl -s -X POST "$BASE_URL/api/orders/brief" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "'$TEST_ORDER_ID'",
    "client_name": "Test Client",
    "client_email": "'$TEST_EMAIL'",
    "service_name": "Logo Design",
    "design_description": "Modern minimalist logo",
    "brand_name": "TestBrand",
    "brand_color": "Blue and White",
    "deadline": "2024-12-31"
  }')
echo "$BRIEF_RESPONSE" | jq .
echo ""

# Test 10: Track Order
echo -e "${YELLOW}TEST 10: Track Order${NC}"
curl -s -X GET "$BASE_URL/api/orders/track/$TEST_ORDER_ID" | jq .
echo ""

# Test 11: Initialize Payment
echo -e "${YELLOW}TEST 11: Initialize Payment${NC}"
PAY_RESPONSE=$(curl -s -X POST "$BASE_URL/api/payment/initialize" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "'$TEST_ORDER_ID'",
    "email": "'$TEST_EMAIL'",
    "amount": 15000,
    "service_name": "Logo Design",
    "payment_type": "Full Payment"
  }')
echo "$PAY_RESPONSE" | jq .
PAY_REFERENCE=$(echo "$PAY_RESPONSE" | jq -r '.reference // empty')
echo "Payment Reference: $PAY_REFERENCE"
echo ""

# Test 12: Send Test Email (Admin)
echo -e "${YELLOW}TEST 12: Send Test Email${NC}"
if [ -n "$ADMIN_TOKEN" ]; then
  curl -s -X POST "$BASE_URL/api/admin/email-test" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"email": "'$TEST_EMAIL'"}' | jq .
else
  echo -e "${RED}SKIPPED: No admin token${NC}"
fi
echo ""

# Test 13: Update Order Status
echo -e "${YELLOW}TEST 13: Update Order Status${NC}"
if [ -n "$ADMIN_TOKEN" ]; then
  curl -s -X PUT "$BASE_URL/api/admin/orders/$TEST_ORDER_ID/status" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "status": "In Queue",
      "message": "Order started - design work in progress"
    }' | jq .
else
  echo -e "${RED}SKIPPED: No admin token${NC}"
fi
echo ""

echo -e "${GREEN}=================================="
echo "Test Suite Complete"
echo "==================================${NC}"

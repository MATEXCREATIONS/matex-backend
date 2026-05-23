# Matex Creations - API Endpoints Reference

## Base URL
```
http://localhost:5001  (local development)
https://your-api-domain.com  (production)
```

## Endpoints

### 1. Create Payment

**Endpoint**: `POST /create-payment`

**Description**: Initialize a Paystack payment transaction

**Request Body**:
```json
{
  "order_id": "MATEX-2026-001",
  "email": "customer@example.com",
  "amount": 6000,
  "service_name": "Graphic Design",
  "payment_type": "Full Payment"
}
```

**Response** (Success):
```json
{
  "success": true,
  "order_id": "MATEX-2026-001",
  "authorization_url": "https://checkout.paystack.com/...",
  "reference": "r4d9k3m2x1",
  "access_code": "..."
}
```

**Response** (Error):
```json
{
  "success": false,
  "message": "Error description"
}
```

---

### 2. Verify Payment

**Endpoint**: `GET /verify-payment/:reference`

**Description**: Verify a Paystack transaction using its reference

**URL Parameters**:
- `reference`: Paystack transaction reference (from callback)

**Response** (Success):
```json
{
  "success": true,
  "status": "success",
  "amount": 6000,
  "reference": "r4d9k3m2x1",
  "order": {
    "id": "MATEX-2026-001",
    "service_name": "Graphic Design",
    "payment_status": "PAID",
    "status": "Pending"
  },
  "customer": {
    "email": "customer@example.com",
    "id": 12345
  }
}
```

---

### 3. Track Order

**Endpoint**: `GET /track-order/:orderId`

**Description**: Get complete order details by Order ID

**URL Parameters**:
- `orderId`: Order ID (e.g., MATEX-2026-001)

**Response** (Success):
```json
{
  "success": true,
  "order": {
    "order_id": "MATEX-2026-001",
    "client_email": "customer@example.com",
    "service_name": "Graphic Design",
    "amount": 6000,
    "payment_status": "PAID",
    "order_status": "Pending",
    "payment_reference": "r4d9k3m2x1",
    "revision_count": 4,
    "latest_progress": "Order received and payment verified",
    "created_at": "2026-05-16T10:30:00Z"
  }
}
```

**Response** (Not Found):
```json
{
  "success": false,
  "message": "Order not found"
}
```

---

### 4. Update Order Status

**Endpoint**: `PUT /update-order-status/:orderId`

**Description**: Update order status and optionally send notification to customer

**URL Parameters**:
- `orderId`: Order ID (e.g., MATEX-2026-001)

**Request Body**:
```json
{
  "status": "In Progress",
  "message": "We've started working on your design. Expecting completion in 3-5 days."
}
```

**Valid Statuses**:
- `Accepted`
- `In Progress`
- `Almost Done`
- `Completed`

**Response** (Success):
```json
{
  "success": true,
  "message": "Order status updated",
  "order": {
    "order_id": "MATEX-2026-001",
    "status": "In Progress"
  }
}
```

---

### 5. Send Designer Notification

**Endpoint**: `POST /send-designer-notification`

**Description**: Resend order details notification to designer

**Request Body**:
```json
{
  "orderId": "MATEX-2026-001"
}
```

**Response** (Success):
```json
{
  "success": true,
  "message": "Designer notification sent"
}
```

---

### 6. Get Order (In-Memory)

**Endpoint**: `GET /order/:orderId`

**Description**: Get order from in-memory store (fallback)

**URL Parameters**:
- `orderId`: Order ID

**Response** (Success):
```json
{
  "success": true,
  "order": {
    "order_id": "MATEX-2026-001",
    "service": "Graphic Design",
    "amount": 6000,
    ...
  }
}
```

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request (missing/invalid parameters) |
| 404 | Not Found |
| 500 | Server Error |

---

## Usage Examples

### JavaScript/Fetch

```javascript
// Create Payment
const response = await fetch('http://localhost:5001/create-payment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    order_id: 'MATEX-2026-001',
    email: 'customer@example.com',
    amount: 6000,
    service_name: 'Graphic Design',
    payment_type: 'Full Payment'
  })
});
const data = await response.json();
window.location.href = data.authorization_url;

// Track Order
const trackResponse = await fetch('http://localhost:5001/track-order/MATEX-2026-001');
const trackData = await trackResponse.json();
console.log(trackData.order);
```

### cURL

```bash
# Create Payment
curl -X POST http://localhost:5001/create-payment \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "MATEX-2026-001",
    "email": "customer@example.com",
    "amount": 6000,
    "service_name": "Graphic Design",
    "payment_type": "Full Payment"
  }'

# Track Order
curl http://localhost:5001/track-order/MATEX-2026-001

# Update Order Status
curl -X PUT http://localhost:5001/update-order-status/MATEX-2026-001 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "In Progress",
    "message": "Design work in progress"
  }'
```

---

## Revision System Reference

**Revision counts by payment type:**

```
Full Payment → 4 revisions
50% Deposit → 2 revisions
Pay After Preview → 1 revision
```

**Revisions included in order response:**
```json
{
  "order": {
    "revision_count": 4,
    "payment_type": "Full Payment"
  }
}
```

---

## Order ID Format

All Order IDs follow this pattern:
```
MATEX-YYYY-NNN

MATEX: Brand prefix
YYYY: Current year
NNN: Sequential 3-digit number (padded with zeros)

Examples:
MATEX-2026-001 (first order of 2026)
MATEX-2026-042 (42nd order of 2026)
```

---

## Email Notifications

### Automatic Emails Sent

1. **Payment Confirmation Email**
   - Sent to customer upon successful payment
   - Contains: Order ID, Service, Amount, Revisions, Status

2. **Designer Notification Email**
   - Sent to designer upon successful payment
   - Contains: Full order details, payment info, client contact

3. **Status Update Emails**
   - Sent via `/update-order-status` endpoint
   - Customizable message per update

4. **Manual Notification Emails**
   - Sent via `/send-designer-notification` endpoint
   - Resends complete order details

---

## Error Handling

**Common Error Responses:**

```json
{
  "success": false,
  "message": "Missing required fields: order_id, email, amount, service_name, payment_type"
}
```

```json
{
  "success": false,
  "message": "Invalid amount. Must be a positive number."
}
```

```json
{
  "success": false,
  "message": "Payment verification failed"
}
```

```json
{
  "success": false,
  "message": "Database query failed"
}
```

---

## Rate Limiting

No rate limiting implemented currently. Recommend adding in production:
- 100 requests per minute per IP for public endpoints
- Stricter limits for payment/verification endpoints

---

## CORS Configuration

CORS is enabled for all origins during development. In production, restrict to your domain:

```javascript
app.use(cors({
  origin: 'https://yourdomain.com',
  credentials: true
}));
```

---

## Version History

- **v1.0** - Initial API with payment and tracking
- **v2.0** - Added order status updates, email notifications, revision system

---

**API Documentation Version**: 2.0  
**Last Updated**: May 2026

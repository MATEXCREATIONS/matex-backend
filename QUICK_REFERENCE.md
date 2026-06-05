# Matex Backend Quick Reference & Troubleshooting

## Quick Start

### 1. Start Backend
```bash
cd matex-backend
npm install  # if needed
npm start
# Should print: ✅ Matex backend is running on http://localhost:5001
```

### 2. Deploy to Supabase
Run these SQL scripts in order:
1. `CREATE_ORDERS_TABLE.sql` - Main orders table
2. `ADD_BRIEF_COLUMNS.sql` - Project brief fields
3. `CREATE_REVIEWS_TABLE.sql` - Reviews table

### 3. Configure .env
See matex-backend/.env template with all required variables

---

## Common Tasks

### Test Review Submission
```bash
curl -X POST http://localhost:5001/api/reviews \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "John Doe",
    "company": "Acme Corp",
    "rating": 5,
    "message": "Great work!"
  }'
```

### Admin Login
```bash
curl -X POST http://localhost:5001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-admin-password"}'
# Returns: {"success": true, "token": "..."}
```

### Fetch Admin Orders
```bash
curl -X GET http://localhost:5001/api/admin/orders \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Update Order Status
```bash
curl -X PUT http://localhost:5001/api/admin/orders/MATEX-2024-001/status \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "Processing",
    "message": "Work in progress"
  }'
```

### Send Test Email
```bash
curl -X POST http://localhost:5001/api/admin/email-test \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

---

## Troubleshooting

### "Port 5001 already in use"
```bash
# Find process using port
lsof -i :5001
# Kill process (macOS/Linux)
kill -9 PID
# Or use different port
PORT=5002 npm start
```

### "Email not sending"
Check .env has:
- SMTP_USER (your email)
- SMTP_PASS (app password, not regular password)
- SMTP_HOST (smtp.gmail.com for Gmail)
- SMTP_PORT (usually 587)

For Gmail: Use "App Password", not regular password

### "Orders not loading"
- Verify SUPABASE_URL and SUPABASE_KEY in .env
- Check Supabase tables exist (run SQL scripts)
- Look for errors in backend console

### "Admin login fails"
- Verify ADMIN_PASSWORD in .env is set
- Verify ADMIN_SECRET_KEY in .env is set
- Check password is correct

### "Reviews not appearing"
1. Submit review on website
2. Login to admin
3. Go to Reviews section
4. Click "Approve" button
5. Refresh website

---

## Feature Checklist

- [x] Review submission working
- [x] Admin review approval working
- [x] Orders loading in dashboard
- [x] Order status dropdown working
- [x] Email test button working
- [x] Customer email notifications working
- [x] Payment initialization working
- [x] Order tracking working
- [x] All endpoints documented
- [x] SQL schemas provided

---

## Files Created/Modified

### Created
- `CREATE_REVIEWS_TABLE.sql` - Reviews table
- `VERIFICATION_REPORT.md` - Full testing report
- `test_endpoints.sh` - Curl test suite
- `QUICK_REFERENCE.md` - This file

### Modified
- `index.html` - Fixed review form API URL
- `admin.js` - All handlers already present
- `server.js` - No changes needed

---

## Production Deployment

### Before Deploy
1. Run all SQL scripts in Supabase
2. Set all .env variables
3. Test email with test button
4. Test admin login
5. Test review submission
6. Test order status update

### Deploy Steps
1. Push code to Git
2. Deploy to Render (or similar)
3. Set environment variables on platform
4. Verify backend starts: `https://your-domain/api/health`
5. Update API_URL in frontend .env
6. Deploy frontend
7. Test everything again

### Monitoring
Check backend logs for:
- Email send failures
- Supabase connection errors
- Payment verification issues
- Admin authentication failures

---

## Support

If issues occur:
1. Check console/logs for error messages
2. Verify all .env variables are set
3. Verify Supabase tables exist
4. Test endpoints with curl commands
5. Check VERIFICATION_REPORT.md for detailed info

---

Last Updated: 2026-06-04

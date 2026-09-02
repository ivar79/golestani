# API Design

## API Architecture
The backend will expose a RESTful API using Laravel, serving the Next.js frontend. All responses should follow a standardized JSON structure.

## Required API Modules
- **Auth**: `/api/auth` (OTP generation, verification, session handling).
- **Public Reference**: `/api/locations` (Cities, neighborhoods), `/api/categories`.
- **Search & Map**: `/api/search` (PostGIS-backed spatial search).
- **Business Profile**: `/api/business` (CRUD for business details).
- **Cards & Designers**: `/api/cards`, `/api/designers`.
- **Subscriptions**: `/api/subscriptions`.
- **Admin**: `/api/admin/*` (Requires admin middleware).

## Authentication Flow
1. **Send OTP**:
   - `POST /api/auth/send-otp`
   - Payload: `{ "phone": "09123456789" }`
   - Response: `200 OK` (OTP sent via SMS).
2. **Verify OTP**:
   - `POST /api/auth/verify-otp`
   - Payload: `{ "phone": "09123456789", "code": "12345" }`
   - Response: `{ "token": "Bearer <jwt_token>", "user": { ... } }`

## Main Endpoints & Examples

### 1. Geospatial Search
**Endpoint**: `GET /api/search/businesses`
**Description**: Fetches businesses within a specific radius using PostGIS `ST_DWithin`.
**Query Params**: 
- `lat` (float, required): User latitude
- `lng` (float, required): User longitude
- `radius` (int, required): Search radius in meters
- `service_type` (string, optional)
- `city_id` (int, optional)
    
**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 101,
      "name": "Sample Store",
      "distance_meters": 450,
      "latitude": 35.7000,
      "longitude": 51.4000,
      "mini_card_details": {
        "image_url": "...",
        "badges": ["verified"]
      }
    }
  ]
}
```

### 2. Update Business Profile
**Endpoint**: `PUT /api/business/profile`
**Headers**: `Authorization: Bearer <token>`
**Payload**:
```json
{
  "name": "My Shop",
  "address": "Street 1...",
  "lat": 35.6991,
  "lng": 51.4011,
  "city_id": 12,
  "social_links": { 
    "instagram": "@myshop" 
  },
  "services": [1, 5, 8]
}
```
**Response**: `200 OK`

### 3. Generate/Update Business Card
**Endpoint**: `POST /api/cards/generate`
**Headers**: `Authorization: Bearer <token>`
**Payload**:
```json
{
  "template_id": 2,
  "font_settings": { "family": "Vazirmatn", "size": "md" },
  "color_settings": { "primary": "#ff5500" }
}
```

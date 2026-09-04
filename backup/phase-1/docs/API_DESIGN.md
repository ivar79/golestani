# Phase 1 API Contract

The Laravel API uses stateless Laravel Sanctum personal access tokens. Clients send tokens as `Authorization: Bearer <token>`. Cookie sessions and JWT are not part of the Phase 1 contract.

## Base URL and common behavior

- Base path: `/api`
- JSON requests should send `Content-Type: application/json`.
- Protected endpoints require `Authorization: Bearer <Sanctum personal access token>`.
- Validation failures return Laravel's standard `422` shape:

```json
{
  "message": "The given data was invalid.",
  "errors": { "phone": ["شماره موبایل معتبر نیست."] }
}
```

## Endpoints implemented in Phase 1

### `GET /api/health`
Public liveness response.

`200 OK`:
```json
{ "status": "ok" }
```

### `POST /api/auth/send-otp`
Requests an OTP for an Iranian mobile number.

Request:
```json
{ "phone": "09123456789" }
```

Validation: `phone` is required, string, and must match `^09\d{9}$`; Persian and Arabic digits are normalized before validation.

`200 OK`:
```json
{ "message": "کد ارسال شد", "expires_in": 120 }
```

`422`: invalid request body.
`429`: more than 3 requests in the route throttle window or more than 3 sends for the phone in 10 minutes.

### `POST /api/auth/verify-otp`
Verifies a one-time code and issues a Sanctum personal access token.

Request:
```json
{ "phone": "09123456789", "code": "12345" }
```

Validation: `phone` follows the send-OTP rule; `code` is required, string, and exactly 5 digits.

`200 OK`:
```json
{
  "token": "<sanctum-personal-access-token>",
  "token_type": "Bearer",
  "user": { "id": 1, "phone": "09123456789", "roles": ["user"] }
}
```

`422`: invalid input or invalid/expired OTP.
`403`: the user account is inactive.
`429`: more than 5 failed verification attempts for the phone in 15 minutes, or route throttle exceeded.

A valid OTP is single-use.

### `GET /api/auth/me`
Requires a Sanctum Bearer token.

`200 OK`:
```json
{
  "id": 1,
  "phone": "09123456789",
  "roles": ["user"],
  "created_at": "2026-08-28T20:00:00+00:00"
}
```

`401`: missing or invalid token.

### `POST /api/auth/logout`
Requires a Sanctum Bearer token. Revokes only the current personal access token.

`200 OK`:
```json
{ "message": "خروج موفق" }
```

`401`: missing or invalid token.

### `GET /api/admin/ping`
Requires a Sanctum Bearer token and the `admin` role.

`200 OK`:
```json
{ "ok": true, "message": "سلام مدیر" }
```

`401`: missing or invalid token.
`403`: authenticated user lacks the `admin` role.

## Rate limiting

- `send-otp`: route throttle `3 requests / 10 minutes`, plus a per-phone service budget of 3 sends / 10 minutes.
- `verify-otp`: route throttle `5 requests / 15 minutes`, plus a per-phone failed-attempt budget of 5 / 15 minutes.
- Rate-limit responses use HTTP `429` and a JSON `message`.

## Planned modules

Locations, categories, search, business profiles, cards, designers, subscriptions, and additional admin APIs are planned for later phases and are not implemented in the Phase 1 API.

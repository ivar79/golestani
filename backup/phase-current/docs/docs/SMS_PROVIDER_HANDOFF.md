# SMS Provider Handoff

## Current state

Local development uses `SMS_DRIVER=log`; no external request is made. The provider-neutral HTTP adapter is available through `SMS_DRIVER=http` and is intentionally disabled until the provider contract is received.

## Information required from the project owner/provider

- Provider name and API documentation URL/version
- Base URL and exact send endpoint
- Authentication method and credential type
- API key/token and the required header name
- Sender number or sender ID, if required
- Request format: JSON, form data, or query parameters
- Exact phone and message field names
- OTP template ID/pattern and approved message text
- Success response format and failure/error codes
- Rate limits, timeout guidance, and retry rules
- Test/sandbox credentials and delivery limitations

## Configuration mapping

```env
SMS_DRIVER=http
SMS_GATEWAY_URL=https://provider.example/send
SMS_GATEWAY_API_KEY=replace-me
SMS_GATEWAY_API_KEY_HEADER=Authorization
SMS_GATEWAY_PHONE_FIELD=phone
SMS_GATEWAY_MESSAGE_FIELD=message
SMS_GATEWAY_TIMEOUT=10
SMS_GATEWAY_RETRIES=2
SMS_GATEWAY_RETRY_SLEEP=200
```

Do not commit real credentials. After receiving the provider documentation, verify the mapping against a sandbox/test number before production activation.

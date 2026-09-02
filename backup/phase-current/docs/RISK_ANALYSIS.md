# Risk Analysis

## 1. Maps and Geospatial Features
- **Risk**: Choosing a map tile provider involves cost, performance, and sanction considerations. Using international providers (like Google Maps) might face billing or IP blocks in Iran, while local alternatives (Neshan, CedarMaps, Map.ir) require API keys.
- **Mitigation**: Clarify the exact provider with the client immediately. Ensure PostGIS is properly indexed (GIST on `geom`) to prevent database bottlenecks during heavy radius searches.

## 2. Third-Party API Dependencies
- **Risk**: Delays in receiving SMS Gateway API keys or Payment Gateway credentials can stall testing for Phases 1 and 5. The contract states these delays do not count against the 45-day development time, but they disrupt the flow.
- **Mitigation**: Request all credentials on Day 1. Use mock services (e.g., logging OTPs to the console) in development if credentials are delayed.

## 3. Security & File Uploads
- **Risk**: Allowing users and designers to upload PDFs and Images (Phase 4) opens vectors for malicious file execution (e.g., uploading PHP shells masked as images).
- **Mitigation**: Implement strict MIME type checking at the Laravel level. Strip EXIF data, force random file names (UUIDs), and store files in non-executable storage buckets (e.g., AWS S3, MinIO) or folders explicitly stripped of execution permissions by Nginx/Apache.

## 4. Performance & Scalability
- **Risk**: Next.js Server-Side Rendering (SSR) can increase server load if caching is not implemented correctly, especially for highly trafficked public business pages.
- **Mitigation**: Utilize Next.js Incremental Static Regeneration (ISR) where appropriate. Heavily cache frequent API responses (cities, service types) in Redis.

## 5. Scope Creep
- **Risk**: The MVP defines strict boundaries (e.g., no Canva-like drag-and-drop, no native apps, no automated wallet payouts). Client expectations might drift during UI reviews.
- **Mitigation**: Strictly enforce the criteria outlined in Phase 4 and the "Out of Scope" section. Require formal Change Requests (via Karlanser) for deviations.

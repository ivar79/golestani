# Questions for Client

Before commencing Phase 1 development, please provide answers or credentials for the following:

## 1. Third-Party Services
- **SMS Gateway**: Which SMS Gateway provider will we be using (e.g., Kavenegar, Ghasedak, FarazSMS)? Please provide the API keys or credentials.
- **Payment Gateway**: Which Payment Gateway will be utilized for subscription tracking? (Note: The MVP mentions manual receipt tracking, but if an API is required later, we need to know the provider to design the database accordingly).
- **Map Provider**: Which Map Tile Provider is preferred for the frontend map UI (e.g., Neshan, Map.ir, CedarMaps, Google Maps)? 

## 2. Design Assets
- **UI/UX**: Who is providing the UI/UX design (e.g., Figma files)?
- **Business Card Templates**: For Phase 4, the system requires "3 standard templates" for business cards. Will your design team provide the base HTML/CSS/SVG templates for these, or should we implement generic default templates?

## 3. Hosting & Infrastructure
- **Server Environment**: Do you already have a staging/production server provisioned? If so, please provide the specifications to ensure it comfortably supports Next.js, Laravel, PostgreSQL + PostGIS, and Redis.
- **Domain**: What is the primary domain name for the platform?

## 4. Functional Clarifications
- **Public Reports**: In Phase 6, "Public Reports Management" (مدیریت گزارش‌های مردمی) is mentioned. Does this refer to end-users reporting inappropriate business content/reviews, or does it refer to general analytics reports?
- **Designer Commissions**: The MVP requires manual calculation/payout of designer commissions. Do you have a specific formula or percentage we need to display in the admin panel to facilitate this manual payout?

## 5. Authentication
- **Admin Security**: For the Admin 2-Factor Authentication (Phase 7), do you prefer SMS-based 2FA or an Authenticator App (TOTP like Google Authenticator)?

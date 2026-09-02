# Project Audit Report

**Date:** 2026-08-27
**Role:** Chief Technology Officer (CTO)
**Objective:** Critical review of project documentation, scope, timelines, and technical assumptions prior to development kickoff.

---

## 1. Critical Issues

*   **Phase 4 Timeline Risk (Card Maker - 7 Days):** The 7-day allocation for Phase 4 is severely underestimated. Building a dynamic business card generator that supports custom fonts, color changes, QR code injection, and PDF/Image exports is a highly complex technical task. Without a predefined rendering strategy (e.g., Client-side HTML2Canvas vs. Server-side Headless Chrome/Puppeteer), this phase poses the highest risk of delaying the entire project.
*   **Phase 6 Timeline Risk (Central Admin Panel - 7 Days):** Delivering 16+ comprehensive CRUD interfaces (Users, Businesses, Designers, Portfolios, Cities, Categories, Services, Badges, Subscriptions, Ads, Content, Logs, etc.) in 7 days is impossible if built from scratch. 
*   **Print-Ready vs. Digital Export Ambiguity:** The requirements state the system must support "printing files" and "converting to dynamic cards", but it does not specify if the generated business cards need to be CMYK, 300 DPI, print-ready PDFs with bleed margins, or simply digital web-friendly PNGs. Print-ready generation adds exponential complexity.

## 2. Medium Issues

*   **Scope Creep in Card Customization:** Even though "Drag & Drop" and "Canva-like tools" are explicitly out of scope, the inclusion of "base font settings, size adjustments, and base color changes" can easily spiral into endless revision loops. The exact boundaries of these adjustments must be mathematically or logically constrained (e.g., only 3 font sizes allowed: sm, md, lg).
*   **Payment Flow Contradiction:** Phase 5 mentions manual verification ("registration of receipt or tracking number and admin approval") but also includes a note about "connection to online payment gateway if needed and APIs are provided". Building both a manual ledger system and an automated IPG webhook system requires different database states and workflows. This dual-path approach is a scope risk.
*   **Location Privacy & Spoofing:** Phase 3 allows users to "manually change their location". This is fine for search, but we must ensure that businesses cannot spoof their physical store location without admin verification, as the core value of the platform relies on accurate proximity sorting.

## 3. Low Priority Issues

*   **Designer Commission Formula:** Phase 5 states that designer commission payouts will be handled manually in the initial version, but the admin panel requires a "designer referrals report". The specific data points required for this report to facilitate manual payouts are not defined.
*   **Public Reports (گزارش‌های مردمی):** The exact schema for user-submitted reports is undefined. We need to know if users are reporting businesses, reviews, or technical issues, and what fields are required.

## 4. Recommended Changes Before Development Starts

*   **Adopt an Admin Panel Builder:** I strongly recommend mandating a Rapid Application Development (RAD) framework for the backend admin panel (e.g., **Laravel Filament** or **Laravel Nova**). This is the *only* way to meet the 7-day deadline for Phase 6 without adding extensive engineering hours.
*   **Lock Down Card Rendering Strategy:** Commit to a specific rendering technology immediately. Recommendation: Use client-side rendering (e.g., `html-to-image` or `html2canvas` in Next.js) to generate digital-ready cards. Avoid server-side PDF generation in Phase 1 to save time.
*   **Standardize Subscription State Machine:** Explicitly define the transition states for subscriptions (e.g., `pending_receipt` -> `active` -> `expired` -> `grace_period`).
*   **Restrict Card Maker Adjustments:** Limit "customizations" to predefined dropdowns (e.g., Select Color Theme: A, B, C; Select Font Size: Small, Medium, Large) rather than free-form color pickers or arbitrary pixel sizing.

## 5. Questions That Must Be Answered By Client

To finalize the technical strategy, the following must be answered in writing:

1.  **Card Maker Output:** Do the generated business cards need to be high-resolution, print-ready CMYK PDFs with bleed lines, or are they strictly for digital use (e.g., sharing on WhatsApp as a PNG/JPG)?
2.  **Admin Technology:** Do you approve the use of an automated Admin panel builder like Laravel Filament for Phase 6 to ensure we meet the 7-day deadline?
3.  **Payment Strategy:** For MVP, are we strictly building the manual receipt upload workflow, or must we allocate time for a live Payment Gateway (IPG) integration? (If IPG, we need the provider API immediately).
4.  **Reporting Data:** What exact data points must be visible in the "Designer referrals report" for your financial team to execute manual payouts?
5.  **Map Tile Provider:** As noted in the initial analysis, what is the exact map provider (Neshan, Map.ir, CedarMaps) we are using? This dictates our frontend SDK integration in Phase 3.
6.  **Card Templates:** Who is responsible for providing the 3 base HTML/CSS designs for the business cards?

---
*Audit Conclusion: The 45-day timeline is aggressive but achievable ONLY IF strict scope management is applied to Phase 4 (Card Maker), Phase 6 utilizes a RAD admin tool, and third-party blocking dependencies (Maps, SMS) are resolved on Day 1.*

---
name: Premium Persian Directory
colors:
  surface: '#f8f9ff'
  surface-dim: '#ccdbf4'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dde9ff'
  surface-container-highest: '#d5e3fd'
  on-surface: '#0d1c2f'
  on-surface-variant: '#43474e'
  inverse-surface: '#233144'
  inverse-on-surface: '#ebf1ff'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#455f87'
  primary: '#022448'
  on-primary: '#ffffff'
  primary-container: '#1e3a5f'
  on-primary-container: '#8aa4cf'
  inverse-primary: '#adc8f5'
  secondary: '#006c4a'
  on-secondary: '#ffffff'
  secondary-container: '#82f5c1'
  on-secondary-container: '#00714e'
  tertiary: '#212426'
  on-tertiary: '#ffffff'
  tertiary-container: '#363a3c'
  on-tertiary-container: '#a1a3a5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#adc8f5'
  on-primary-fixed: '#001c3b'
  on-primary-fixed-variant: '#2d486d'
  secondary-fixed: '#85f8c4'
  secondary-fixed-dim: '#68dba9'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005137'
  tertiary-fixed: '#e0e3e5'
  tertiary-fixed-dim: '#c4c7c9'
  on-tertiary-fixed: '#191c1e'
  on-tertiary-fixed-variant: '#444749'
  background: '#f8f9ff'
  on-background: '#0d1c2f'
  surface-variant: '#d5e3fd'
typography:
  display-lg:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 60px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 44px
  headline-lg-mobile:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  title-md:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is engineered for a premium Persian local business directory, balancing the authority of a high-end SaaS platform with the warmth and accessibility required for local commerce. The brand personality is **trustworthy, modern, and sophisticated**.

The visual direction follows a **Modern SaaS/Corporate** aesthetic with **Glassmorphic** accents. It prioritizes clarity and high-quality finishes, utilizing subtle depth and frosted-glass effects to distinguish premium listings and key interactions. Every element is optimized for a Right-to-Left (RTL) reading experience, ensuring the visual weight and flow feel natural for Persian users. The emotional response should be one of professional reliability and technological advancement.

## Colors

The palette is anchored by **Navy Blue (#1e3a5f)** to establish institutional trust and stability. **Emerald Green (#059669)** serves as a vibrant accent for primary actions, success states, and growth-oriented call-to-outs. 

- **Primary:** Navy blue for navigation, headers, and core brand elements.
- **Accent:** Emerald green for buttons, status indicators, and highlights.
- **Backgrounds:** A clean White (#ffffff) foundation with Light Gray (#f8fafc) used for surface layering and separation.
- **Text:** Deep charcoal (#1e293b) for primary content to maintain high legibility and a premium feel, with lighter slate tones for secondary metadata.

## Typography

The typography system is **RTL-first**, utilizing a high-quality Persian typeface (Vazirmatn) paired with **Hanken Grotesk** for numerical data and English strings. This combination ensures a clean, geometric, and modern appearance.

- **Headlines:** Bold and authoritative, using tighter tracking for the display styles.
- **Body:** Optimised for long-form readability with generous line heights to accommodate Persian script's ascenders and descenders.
- **Numerical Data:** All prices and statistics should use tabular lining figures for alignment in directory listings.

## Layout & Spacing

This design system employs a **fluid 12-column grid** for desktop and a **4-column grid** for mobile devices. The rhythm is based on a **4px baseline** to ensure precision in both English and Persian characters.

- **RTL Orientation:** All layouts must be mirrored. Sidebars appear on the right, and the content flow moves from right to left.
- **Safe Zones:** Horizontal margins are increased on desktop (32px) to provide a spacious, premium feel. 
- **Content Density:** Directory listings use a "comfortable" spacing model with 24px gutters to prevent visual clutter in search results.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Glassmorphism**. Surfaces are elevated using soft, multi-layered shadows that simulate a natural light source.

- **Low Elevation:** Used for standard cards. Subtle 1px border (#e2e8f0) with a very soft shadow (0px 4px 12px rgba(0,0,0,0.03)).
- **High Elevation (Glass):** Used for featured listings or floating navigation. These elements use a background blur (12px to 20px) and a semi-transparent white fill (opacity 80%).
- **Interactive States:** On hover, cards should lift slightly with an increased shadow spread and a subtle emerald-green inner glow to signify interactivity.

## Shapes

The shape language is defined by **large, friendly corner radii**. This softens the professional navy blue and creates an approachable directory experience.

- **Standard Components:** Buttons, input fields, and tags use a `0.5rem` (8px) radius.
- **Containers:** Large cards and section blocks use a `rounded-xl` (24px) radius to create the signature "Premium SaaS" look.
- **Interactive Elements:** Checkboxes and radio buttons maintain a slightly rounded profile to match the global aesthetic.

## Components

### Buttons
- **Primary:** Solid Navy Blue with white text. High-contrast, sharp, and authoritative.
- **Success/CTA:** Solid Emerald Green. Used exclusively for "Book Now" or "Contact Business."
- **Ghost:** Transparent background with a thin slate border, used for secondary filtering.

### Cards (Business Listings)
- **Glassmorphic Effect:** Featured listings utilize a `backdrop-filter: blur(16px)` and a subtle gradient border to stand out from the grid.
- **Standard Card:** White background, 24px rounded corners, and a soft 1px border.

### Form Fields
- Inputs must have the label right-aligned.
- Focus states utilize an Emerald Green ring with a 4px offset to provide clear visual feedback without obscuring text.

### Chips & Badges
- Used for categories (e.g., "Restaurant," "Medical"). Use light tints of the primary color (Navy) with dark text to keep them legible but secondary to the listing name.

### Search Bar
- The primary entry point. Centered or right-aligned, featuring a prominent search icon on the left (at the end of the Persian text flow) and a "Filter" button on the right.
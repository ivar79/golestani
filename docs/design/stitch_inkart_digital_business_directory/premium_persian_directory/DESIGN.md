---
name: InCard Nocturne
colors:
  surface: '#111418'
  surface-dim: '#111418'
  surface-bright: '#37393e'
  surface-container-lowest: '#0b0e12'
  surface-container-low: '#191c20'
  surface-container: '#1d2024'
  surface-container-high: '#272a2f'
  surface-container-highest: '#323539'
  on-surface: '#e1e2e8'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#e1e2e8'
  inverse-on-surface: '#2e3135'
  outline: '#909097'
  outline-variant: '#46464c'
  surface-tint: '#c0c6de'
  primary: '#c0c6de'
  on-primary: '#2a3043'
  primary-container: '#020617'
  on-primary-container: '#72778d'
  inverse-primary: '#585e73'
  secondary: '#81d8ae'
  on-secondary: '#003825'
  secondary-container: '#006c4a'
  on-secondary-container: '#93eabf'
  tertiary: '#68dba9'
  on-tertiary: '#003825'
  tertiary-container: '#000904'
  on-tertiary-container: '#008960'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dce1fb'
  primary-fixed-dim: '#c0c6de'
  on-primary-fixed: '#151b2d'
  on-primary-fixed-variant: '#40465a'
  secondary-fixed: '#9df4c9'
  secondary-fixed-dim: '#81d8ae'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005237'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#111418'
  on-background: '#e1e2e8'
  surface-variant: '#323539'
  surface-dark: '#0a1128'
  surface-cta: '#050b1a'
  border-white-low: rgba(255, 255, 255, 0.1)
  glow-emerald: rgba(0, 108, 74, 0.4)
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
  caption-xs:
    fontFamily: Vazirmatn, Hanken Grotesk
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  margin-mobile: 16px
  margin-desktop: 32px
  gutter: 24px
  container-max: 1280px
  section-gap: 96px
  unit: 4px
---

## Brand & Style
The brand identity is "InCard," a modern digital business card platform. The visual style is a sophisticated blend of **Glassmorphism** and **High-Tech Futurism**. It targets professionals and modern businesses looking to bridge the gap between physical networking and digital presence. 

The aesthetic is characterized by a deep "Nocturne" dark mode, utilizing multi-layered translucent surfaces, vibrant neon accents (specifically emerald greens), and atmospheric background blurs that create a sense of infinite depth. The tone is premium, innovative, and highly organized, evoking a feeling of "digital craft."

## Colors
The palette is rooted in a deep navy-black (`#020617`) which serves as the canvas. 
- **Primary/Background:** Deep space navy providing the foundation for all glass effects.
- **Secondary (Action):** A rich emerald green (`#006c4a`) used for primary call-to-actions and branding elements.
- **Tertiary (Highlight):** A minty "secondary-container" green (`#82f5c1`) used for hover states, iconography, and subtle accents to provide high-energy contrast against the dark background.
- **Surface Accents:** Transparent white overlays (5-10% opacity) are used extensively for borders and glass panels to define structure without adding heavy solid colors.

## Typography
The system uses a bilingual typographic approach, pairing the clean, legible **Vazirmatn** for Persian script with **Hanken Grotesk** for Latin/numeric content. 
- **Scale:** High contrast between Display and Body levels. Headlines use heavy weights (700-800) to stand out against atmospheric backgrounds.
- **Rhythm:** Line heights are generous (1.4x - 1.5x) to ensure legibility on high-density screens.
- **Visual Treatment:** White text is the default, while "surface-variant" text uses a slightly desaturated gray-blue to establish hierarchy in secondary descriptions.

## Layout & Spacing
The system utilizes a **Fixed Grid** philosophy for desktop (max 1280px) and a fluid, margin-safe approach for mobile.
- **Vertical Rhythm:** Large section gaps (96px+) create breathing room between feature blocks. 
- **Grid:** A standard 12-column grid is implied for desktop content, though specific showcases (like the "How it Works" section) utilize a centered flex layout.
- **Navigation:** The header is fixed with a backdrop-blur, requiring a padding-top on the main container to prevent content occlusion.

## Elevation & Depth
Elevation is conveyed through **Glassmorphism** rather than traditional shadows. 
- **Surfaces:** Use `backdrop-blur-xl` (or 20px-40px blur) combined with semi-transparent background colors (`#0a1128/60`).
- **Borders:** Thin, 1px high-contrast outlines using `white/10` or `white/5` serve as the primary divider between layers.
- **Atmospheric Glow:** Large, low-opacity radial gradients (Primary or Secondary colors with 80px-100px blur) sit behind content to create "pockets" of light, suggesting a 3D environment.
- **Shadows:** Reserved for buttons and interactive cards to suggest "lift" on hover, often tinted with the secondary green (`shadow-secondary/20`).

## Shapes
The shape language is consistently **Rounded**, leaning towards a friendly but professional "squircle" feel.
- **Standard Radius:** 0.5rem (8px) for small elements.
- **Container Radius:** 1.5rem (24px) to 2rem (32px) for large glass panels and section containers.
- **Interactive Elements:** Buttons and Input fields use `rounded-xl` (12px) to provide a soft, tactile feel.
- **Specialty Shapes:** Pill-shaped (9999px) badges are used for "New" or "Verified" indicators.

## Components
- **Buttons:** 
  - *Primary:* Emerald green background, white text, subtle outer glow.
  - *Ghost:* 5% white background with 10% white border; turns 10% white on hover.
- **Cards (Glass):** Deep navy translucent backgrounds, 1px white/10 borders, and heavy backdrop blurs. Hover states should include a 1.05x scale or a slight upward translation.
- **Iconography:** Linear icons (Material Symbols Outlined) with a weight of 400. Icons in featured areas should be enclosed in a rounded-2xl container with a 10% emerald tint.
- **Progress/Steps:** Represented by circular nodes connected by dashed animated paths (sine waves) to visualize flow.
- **QR Containers:** Stark white backgrounds to ensure scanability, with rounded corners to match the overall design system.
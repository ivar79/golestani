---
name: InCard Alabaster
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#1f6a51'
  on-secondary: '#ffffff'
  secondary-container: '#a8f2d1'
  on-secondary-container: '#277057'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#151b2d'
  on-tertiary-container: '#7d8399'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#a8f2d1'
  secondary-fixed-dim: '#8dd5b6'
  on-secondary-fixed: '#002116'
  on-secondary-fixed-variant: '#00513b'
  tertiary-fixed: '#dce1fb'
  tertiary-fixed-dim: '#c0c6de'
  on-tertiary-fixed: '#151b2d'
  on-tertiary-fixed-variant: '#40465a'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
  surface-primary: '#FFFFFF'
  surface-secondary: '#F8FAFC'
  border-base: '#E2E8F0'
  accent-emerald: '#025941'
  accent-navy: '#151B2D'
  text-main: '#0F172A'
  text-muted: '#64748B'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 60px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 44px
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Vazirmatn
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Vazirmatn
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  caption-xs:
    fontFamily: Vazirmatn
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
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
  section-gap: 96px
  container-max: 1280px
---

## Brand & Style
The design system transitions from its "Nocturne" roots into a refined, high-clarity light mode aesthetic. The brand personality remains sophisticated and professional, but shifts its emotional response from "atmospheric mystery" to "openness, precision, and executive clarity." 

The design style is a blend of **Minimalism** and **Modern Corporate**, utilizing heavy whitespace to emphasize content. It maintains the "digital craft" feel through subtle tactile details—replacing neon glows with soft, purposeful shadows and replacing deep transparency with clean, layered surfaces. The target audience remains modern professionals, now presented with a high-legibility interface optimized for daytime productivity and readability.

## Colors
The palette is engineered for high contrast and executive appeal. 
- **Primary Surface:** Pure `#FFFFFF` provides a sterile, clean canvas for all primary interactions and content containers.
- **Secondary Surface:** `#F8FAFC` is used for page backgrounds and subtle grouping, creating a gentle distinction from the white content cards.
- **Functional Accents:** The Emerald (`#025941`) and Navy (`#151B2D`) are preserved from the original system but are recalibrated for light-background accessibility. Emerald is reserved for primary actions and "success" states, while Navy serves as the core typographic anchor and secondary action color.
- **Borders:** A consistent `#E2E8F0` defines structure without visual noise, replacing the translucent borders of the dark mode.

## Typography
The system maintains its bilingual excellence, utilizing **Vazirmatn** for its superior Persian legibility and **Hanken Grotesk** for Latin numerals and headers. 

In this light variant, typography carries the weight of the hierarchy. Headlines are rendered in deep Slate-900 to ensure a strong visual anchor against white backgrounds. Body text utilizes a slightly softer weight to improve long-form reading comfort. Letter spacing is slightly tightened on display sizes to maintain the "premium" feel across large viewports.

## Layout & Spacing
The layout follows a **Fixed Grid** model for desktop, centered within a 1280px container to ensure content density remains professional and scannable. 

The rhythm is defined by a 4px base unit. Wide section gaps (96px) are essential to this design system's aesthetic, providing the "breathable" luxury associated with high-end digital products. On mobile, the system shifts to a fluid layout with 16px side margins, ensuring that cards and interactive elements span the full width available to maximize touch targets.

## Elevation & Depth
In this design system, depth is achieved through **Tonal Layers** and **Ambient Shadows** rather than glassmorphism.
- **Layering:** Components sit on the `#F8FAFC` background. Primary cards use `#FFFFFF` to "lift" off the page.
- **Shadows:** Use extremely soft, diffused shadows with a Navy tint to suggest elevation. A standard "elevated" state uses `offset: 0 4px, blur: 20px, color: rgba(15, 23, 42, 0.05)`.
- **Interactions:** On hover, interactive cards should transition to a slightly deeper shadow (`0 12px 30px rgba(15, 23, 42, 0.08)`) and a subtle 2px upward translation.
- **Outlines:** Low-contrast outlines (`#E2E8F0`) are used for all secondary containers to maintain structure without relying solely on shadows, keeping the UI looking "flat-but-layered."

## Shapes
The shape language is defined by oversized, generous curves that evoke a friendly, modern tech aesthetic. 
- **Base Elements:** Buttons and inputs use `12px` (rounded-xl) to feel tactile.
- **Content Containers:** Main cards and sections utilize `24px` (rounded-2xl) to `32px` (rounded-3xl) radii, creating a distinct "squircle" look that defines the product's silhouette.
- **Functional Shapes:** Badges and tags remain pill-shaped (9999px) to contrast against the more structured rectangular containers.

## Components
- **Buttons:** 
  - *Primary:* Emerald background (`#025941`), white text. High-contrast and authoritative.
  - *Secondary:* Navy background (`#151B2D`), white text. Used for less critical actions.
  - *Outline:* White background, `#E2E8F0` border, Navy text.
- **Input Fields:** White background with a 1px `#E2E8F0` border. On focus, the border transitions to Navy with a subtle 4px Navy-tinted outer glow.
- **Chips/Tags:** Light Slate backgrounds (`#F1F5F9`) with Navy text for a neutral, organized look.
- **Cards:** White surfaces with 24px corner radius. They should feature a 1px border in `#E2E8F0` to ensure they don't wash out against the secondary surface.
- **Lists:** Clean dividers using the border color. Items should have a subtle background hover state of `#F8FAFC`.
- **QR Containers:** Maintain high-contrast white backgrounds with a subtle drop shadow to emphasize their importance as the "bridge" to the digital profile.
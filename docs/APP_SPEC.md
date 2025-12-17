# TOVIS – Application Specification

## Roles
### Client
- Browse Looks feed
- Book services
- Join waitlists
- Leave reviews with media

### Professional
- Manage services & calendar
- Capture before/after media
- Approve consultation pricing
- Control what appears in Portfolio & Looks
- View Looks feed like a client

---

## Media Rules
- All media must be linked to ≥1 service
- Media can be linked to multiple services
- Review-submitted media is immutable by professionals
- Professionals can choose to:
  - Add review media to Portfolio
  - Make media eligible for Looks
- Portfolio is a filtered view of MediaAssets

---

## Portfolio
- Grid layout (IG/TikTok style)
- Shows only:
  - `visibility = PUBLIC`
  - `isFeaturedInPortfolio = true`

---

## Looks Feed
- Global discovery feed
- Vertical scrolling media
- Each post includes:
  - Media (image/video)
  - Professional (clickable)
  - Service tags
  - Book Now CTA
- Media must be service-tagged
- Gold star indicates original professional who performed service

---

## Booking From Looks
- Book Now opens booking panel
- Shows:
  - Service price & duration
  - Availability
  - Alternate professionals offering same service
- If no availability:
  - Client may join waitlist
  - Client selects date range + time preference

---

## Waitlist
- Tied to:
  - Client
  - Professional
  - Service
  - Optional originating MediaAsset
- Status-driven notifications

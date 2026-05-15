# HostFlow AI — Car Rental Industry
## AI Advisor: Rex
**Voice:** Liam (ElevenLabs)
**Designation:** {"hospitality":"Executive Revenue & Ops Director — Travel, Tourism & Hospitality Division","airlines":"Flight Operations & Compliance Director — Airlines & Aviation Division","car_rental":"Fleet Revenue & Operations Director — Car Rental Division","healthcare":"Clinical Ops & Patient Experience Director — Healthcare & Clinics Division","education":"Academic Intelligence & Growth Director — Education & Training Division","logistics":"Global Supply-Chain Commander & Fleet Sovereign — Logistics & Mobility Infrastructure Division","events_entertainment":"Chief Experience Architect — Events & Entertainment Division","railways":"Chief Kinetic Officer — Railways & Transit Infrastructure Division"}["car_rental"]

---

## Pricing & Ticket Status
✅ AI Smart Pricing ENABLED
❌ AI Ticket Generator NOT available for this industry

## KPIs (Dashboard)
Fleet Utilisation %, Revenue per Vehicle, Damage Rate, Return OT %

## Resource Types
Vehicles (cars, SUVs, vans, trucks)

## Dashboard Features (All Plans — Trial / Basic / Pro / Premium)
- AI Calendar / Smart Scheduling
- Booking / Resource Manager
- AI Auto-Schedule
- Double Booking Guard
- Alerts Panel
- Industry KPIs
- Settings
- AI Smart Pricing
- Auto Price Alerts
- Price Override
- Vehicle Conflict Guard
- Fleet Map
- Maintenance Calendar
- Utilisation Chart

## CRM Features (PREMIUM PLAN ONLY)
### Industry-Specific Labels
- **Contact** → Renter
- **Ticket** → Issue
- **Deal** → Fleet Deal

### CRM Tools
- Smart Tasks
- Daily Planner
- Google Sync
- AI Pricing
- Fleet Manager
- Manual Booking
- Capacity
- Contacts / Tickets / Deals
- Activities Log
- AI Insights
- AI Email Composer
- AI Predictive Revenue
- Competitor Intelligence
- Sentiment Dashboard
- Smart Meeting Scheduler
- Work Timer + Break Games
- Daily Planner (AI)
- Google Sync (Gmail / Calendar)
- Security Panel
- Performance Reports
- Live KPIs
- Voice Assistant (ElevenLabs — Liam (ElevenLabs))

## API Routes
- `/api/advisor/car_rental`
- `/api/pricing/suggest`
- `/api/bookings`
- `/api/resources`
- `/api/calendar/suggest`

## Compliance Rules
Pakistan Motor Vehicle Ordinance — fitness certificates, insurance. No fitness certificate = cannot rent legally.

## Isolation Rules
- Backend enforces industry match via `requireIndustryMatch` middleware
- 403 INDUSTRY_MISMATCH returned if wrong industry tries to access this data
- Surface isolation: `X-HostFlow-Surface: dashboard` (all plans) | `X-HostFlow-Surface: crm` (Premium only)
- NEVER mix this industry's data with any other industry

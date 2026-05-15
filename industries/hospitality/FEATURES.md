# HostFlow AI — Hospitality Industry
## AI Advisor: Aria
**Voice:** Sarah (ElevenLabs)
**Designation:** {"hospitality":"Executive Revenue & Ops Director — Travel, Tourism & Hospitality Division","airlines":"Flight Operations & Compliance Director — Airlines & Aviation Division","car_rental":"Fleet Revenue & Operations Director — Car Rental Division","healthcare":"Clinical Ops & Patient Experience Director — Healthcare & Clinics Division","education":"Academic Intelligence & Growth Director — Education & Training Division","logistics":"Global Supply-Chain Commander & Fleet Sovereign — Logistics & Mobility Infrastructure Division","events_entertainment":"Chief Experience Architect — Events & Entertainment Division","railways":"Chief Kinetic Officer — Railways & Transit Infrastructure Division"}["hospitality"]

---

## Pricing & Ticket Status
✅ AI Smart Pricing ENABLED
❌ AI Ticket Generator NOT available for this industry

## Business Sub-Types (strictly isolated — never mix)
- hotel_property (Hotels, resorts, vacation rentals)
- travel_tours (Travel agencies, tour operators, packages)

## KPIs (Dashboard)
Occupancy %, RevPAR, ADR, GOPPAR, Guest Satisfaction Score

## Resource Types
Rooms, Suites, Villas, Serviced Apartments, Tour Packages

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
- OTA Channel Sync
- Occupancy Heatmap
- RevPAR Calendar
- Gap-Night Filler
- Guest Scoring
- Competitor Radar

## CRM Features (PREMIUM PLAN ONLY)
### Industry-Specific Labels
- **Contact** → Guest
- **Ticket** → Request
- **Deal** → Booking Deal

### CRM Tools
- Smart Tasks
- Daily Planner
- Google Sync
- AI Calendar
- AI Pricing
- Manual Booking
- Resource Manager
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
- Voice Assistant (ElevenLabs — Sarah (ElevenLabs))

## API Routes
- `/api/advisor/hospitality`
- `/api/pricing/suggest`
- `/api/bookings`
- `/api/resources`
- `/api/calendar/suggest`

## Compliance Rules
PTDC hotel classification, Food safety regulations, Tourism registration

## Isolation Rules
- Backend enforces industry match via `requireIndustryMatch` middleware
- 403 INDUSTRY_MISMATCH returned if wrong industry tries to access this data
- Surface isolation: `X-HostFlow-Surface: dashboard` (all plans) | `X-HostFlow-Surface: crm` (Premium only)
- NEVER mix this industry's data with any other industry

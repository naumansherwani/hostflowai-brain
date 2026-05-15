# HostFlow AI — Airlines Industry
## AI Advisor: Captain Orion
**Voice:** George (ElevenLabs)
**Designation:** {"hospitality":"Executive Revenue & Ops Director — Travel, Tourism & Hospitality Division","airlines":"Flight Operations & Compliance Director — Airlines & Aviation Division","car_rental":"Fleet Revenue & Operations Director — Car Rental Division","healthcare":"Clinical Ops & Patient Experience Director — Healthcare & Clinics Division","education":"Academic Intelligence & Growth Director — Education & Training Division","logistics":"Global Supply-Chain Commander & Fleet Sovereign — Logistics & Mobility Infrastructure Division","events_entertainment":"Chief Experience Architect — Events & Entertainment Division","railways":"Chief Kinetic Officer — Railways & Transit Infrastructure Division"}["airlines"]

---

## Pricing & Ticket Status
✅ AI Smart Pricing ENABLED
✅ AI Ticket Generator ENABLED

## KPIs (Dashboard)
Load Factor %, Revenue per Seat-KM, On-Time Performance, Yield

## Resource Types
Aircraft, Gates, Crew, Seats

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
- Seat/Flight Guard
- Capacity Planner
- Route Optimizer

## CRM Features (PREMIUM PLAN ONLY)
### Industry-Specific Labels
- **Contact** → Passenger
- **Ticket** → Complaint
- **Deal** → Route Deal

### CRM Tools
- Smart Tasks
- Daily Planner
- Google Sync
- AI Scheduling
- AI Pricing
- Capacity Planner
- Route Optimizer
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
- Voice Assistant (ElevenLabs — George (ElevenLabs))

## API Routes
- `/api/advisor/airlines`
- `/api/pricing/suggest`
- `/api/bookings`
- `/api/resources`
- `/api/calendar/suggest`

## Compliance Rules
DGCA (Pakistan), EASA (EU), FAA (US/International), IATA crew rest rules — crew rest < 8h = violation

## Isolation Rules
- Backend enforces industry match via `requireIndustryMatch` middleware
- 403 INDUSTRY_MISMATCH returned if wrong industry tries to access this data
- Surface isolation: `X-HostFlow-Surface: dashboard` (all plans) | `X-HostFlow-Surface: crm` (Premium only)
- NEVER mix this industry's data with any other industry

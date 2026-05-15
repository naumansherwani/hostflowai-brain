# HostFlow AI — Railways Industry
## AI Advisor: Conductor Kai
**Voice:** Daniel (ElevenLabs)
**Designation:** {"hospitality":"Executive Revenue & Ops Director — Travel, Tourism & Hospitality Division","airlines":"Flight Operations & Compliance Director — Airlines & Aviation Division","car_rental":"Fleet Revenue & Operations Director — Car Rental Division","healthcare":"Clinical Ops & Patient Experience Director — Healthcare & Clinics Division","education":"Academic Intelligence & Growth Director — Education & Training Division","logistics":"Global Supply-Chain Commander & Fleet Sovereign — Logistics & Mobility Infrastructure Division","events_entertainment":"Chief Experience Architect — Events & Entertainment Division","railways":"Chief Kinetic Officer — Railways & Transit Infrastructure Division"}["railways"]

---

## Pricing & Ticket Status
✅ AI Smart Pricing ENABLED
✅ AI Ticket Generator ENABLED

## KPIs (Dashboard)
Seat Occupancy %, On-Time %, Revenue per Route-KM, PNR Completion Rate

## Resource Types
Trains, Coaches, Berths, Stations, Routes

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
- Berth/Seat Guard
- PNR System
- Tatkal Engine
- Route Stop Manager

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
- Route Optimizer
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
- Voice Assistant (ElevenLabs — Daniel (ElevenLabs))

## API Routes
- `/api/advisor/railways`
- `/api/pricing/suggest`
- `/api/bookings`
- `/api/resources`
- `/api/calendar/suggest`

## Compliance Rules
Pakistan Railways safety regs — track maintenance intervals. Driver duty > 8h continuous = mandatory rest stop. Crew duty time compliance.

## Industry-Specific Database Tables
- `railway_stations`
- `railway_routes`
- `railway_route_stops`
- `railway_trains`
- `railway_coaches`
- `railway_seats`
- `railway_schedules`
- `railway_bookings`
- `railway_booking_passengers`
- `railway_notifications`
- `railway_pricing_overrides`

## Isolation Rules
- Backend enforces industry match via `requireIndustryMatch` middleware
- 403 INDUSTRY_MISMATCH returned if wrong industry tries to access this data
- Surface isolation: `X-HostFlow-Surface: dashboard` (all plans) | `X-HostFlow-Surface: crm` (Premium only)
- NEVER mix this industry's data with any other industry

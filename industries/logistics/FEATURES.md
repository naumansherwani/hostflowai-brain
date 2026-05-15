# HostFlow AI — Logistics Industry
## AI Advisor: Atlas
**Voice:** Will (ElevenLabs)
**Designation:** {"hospitality":"Executive Revenue & Ops Director — Travel, Tourism & Hospitality Division","airlines":"Flight Operations & Compliance Director — Airlines & Aviation Division","car_rental":"Fleet Revenue & Operations Director — Car Rental Division","healthcare":"Clinical Ops & Patient Experience Director — Healthcare & Clinics Division","education":"Academic Intelligence & Growth Director — Education & Training Division","logistics":"Global Supply-Chain Commander & Fleet Sovereign — Logistics & Mobility Infrastructure Division","events_entertainment":"Chief Experience Architect — Events & Entertainment Division","railways":"Chief Kinetic Officer — Railways & Transit Infrastructure Division"}["logistics"]

---

## Pricing & Ticket Status
❌ AI Smart Pricing BLOCKED — 403 PRICING_NOT_AVAILABLE — AI pricing strictly blocked for logistics
❌ AI Ticket Generator NOT available for this industry

## KPIs (Dashboard)
On-Time Delivery %, Fleet Utilisation %, Cost per KM, Shipment Loss Rate

## Resource Types
Trucks, Warehouses, Drivers, Shipment Slots

## Dashboard Features (All Plans — Trial / Basic / Pro / Premium)
- AI Calendar / Smart Scheduling
- Booking / Resource Manager
- AI Auto-Schedule
- Double Booking Guard
- Alerts Panel
- Industry KPIs
- Settings
- Shipment Guard
- Route Optimizer
- Warehouse Slot Manager
- Fleet Tracker
- Cold Chain Monitor
- HAZMAT Flag

## CRM Features (PREMIUM PLAN ONLY)
### Industry-Specific Labels
- **Contact** → Client
- **Ticket** → Issue
- **Deal** → Contract

### CRM Tools
- Smart Tasks
- Daily Planner
- Google Sync
- Route Optimizer
- Capacity
- Fleet Manager
- AI Scheduling
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
- Voice Assistant (ElevenLabs — Will (ElevenLabs))

## API Routes
- `/api/advisor/logistics`
- `/api/bookings`
- `/api/resources`
- `/api/calendar/suggest`

## Compliance Rules
Pakistan Customs Act — commercial invoice, packing list, bill of lading mandatory for international freight. Missing docs = flag before departure.

## Isolation Rules
- Backend enforces industry match via `requireIndustryMatch` middleware
- 403 INDUSTRY_MISMATCH returned if wrong industry tries to access this data
- Surface isolation: `X-HostFlow-Surface: dashboard` (all plans) | `X-HostFlow-Surface: crm` (Premium only)
- NEVER mix this industry's data with any other industry

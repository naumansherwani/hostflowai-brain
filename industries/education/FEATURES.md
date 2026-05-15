# HostFlow AI — Education Industry
## AI Advisor: Professor Sage
**Voice:** Brian (ElevenLabs)
**Designation:** {"hospitality":"Executive Revenue & Ops Director — Travel, Tourism & Hospitality Division","airlines":"Flight Operations & Compliance Director — Airlines & Aviation Division","car_rental":"Fleet Revenue & Operations Director — Car Rental Division","healthcare":"Clinical Ops & Patient Experience Director — Healthcare & Clinics Division","education":"Academic Intelligence & Growth Director — Education & Training Division","logistics":"Global Supply-Chain Commander & Fleet Sovereign — Logistics & Mobility Infrastructure Division","events_entertainment":"Chief Experience Architect — Events & Entertainment Division","railways":"Chief Kinetic Officer — Railways & Transit Infrastructure Division"}["education"]

---

## Pricing & Ticket Status
❌ AI Smart Pricing BLOCKED — 403 PRICING_NOT_AVAILABLE — AI pricing strictly blocked for education
❌ AI Ticket Generator NOT available for this industry

## KPIs (Dashboard)
Enrolment Rate, Class Fill %, Student Completion Rate, Revenue per Student

## Resource Types
Classrooms, Labs, Teachers, Course Slots

## Dashboard Features (All Plans — Trial / Basic / Pro / Premium)
- AI Calendar / Smart Scheduling
- Booking / Resource Manager
- AI Auto-Schedule
- Double Booking Guard
- Alerts Panel
- Industry KPIs
- Settings
- Class Conflict Guard
- Timetable Builder
- Enrolment Tracker
- Student Outcome Dashboard

## CRM Features (PREMIUM PLAN ONLY)
### Industry-Specific Labels
- **Contact** → Student
- **Ticket** → Support
- **Deal** → Enrollment

### CRM Tools
- Smart Tasks
- Daily Planner
- Google Sync
- AI Scheduling
- Manual Booking
- Capacity
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
- Voice Assistant (ElevenLabs — Brian (ElevenLabs))

## API Routes
- `/api/advisor/education`
- `/api/bookings`
- `/api/resources`
- `/api/calendar/suggest`

## Compliance Rules
HEC (Higher Education Commission Pakistan) regulations for degree programs. Always recommend HEC compliance for degree-granting ops.

## Isolation Rules
- Backend enforces industry match via `requireIndustryMatch` middleware
- 403 INDUSTRY_MISMATCH returned if wrong industry tries to access this data
- Surface isolation: `X-HostFlow-Surface: dashboard` (all plans) | `X-HostFlow-Surface: crm` (Premium only)
- NEVER mix this industry's data with any other industry

# 369aiAlphalize

> One Android/iOS client for the whole Odoo back office — sales, purchase, inventory,
> payments, attendance and vehicle tracking, built for staff who work away from a desk.

369aiAlphalize is an [Expo](https://expo.dev) React Native app that puts around forty Odoo
workflows behind a single home screen. A salesperson raises an order or an estimate and prints
the invoice from the phone; a driver's trip is tracked and turned into field attendance; a
collector takes a payment with a signature and GPS stamp; a supervisor reviews late records and
KPIs. Each workflow is backed by a custom Odoo module, and every one of those modules ships in
[odoo_modules/](odoo_modules/) beside the app.

The app is server-agnostic: the Odoo URL is entered at login and stored on the device, so the
same build can point at any deployment. One codebase also produces several differently branded
APKs — see [Multi-brand builds](#multi-brand-builds).

## Features

The home screen groups its options into **Customer**, **Employee** and **Services** sections.

**Sales & billing** — Easy Sales and Estimate Sale (one-click entry), Sales Order, Quick Sales
Return, a full POS flow (register → products → cart → payment → receipt), Direct Invoice, an
Invoice Scanner with live OCR, and a mobile-format PDF invoice.

**Purchase & stock** — Easy Purchase, Estimate Purchase, Quick Purchase Return, Purchases,
Inventory, Stock Transfer, Product Creation, Box Inspection and Spare Management.

**Finance & control** — Cash Collection, Payments captured with customer signature and GPS
location, Credit Management with WhatsApp/email approval, Partner Ledger, Gross Profit Report,
below-cost sale protection, and Transaction Audit.

**Workforce** — User Attendance in both Office and Work-From-Home modes (fingerprint, registered
device check, photo and location verification), Late Records and waivers, Staff Tracking, Task
Manager, and a KPI dashboard with action items and participants.

**Field operations** — Customer Visits and Visit Plans, CRM, Market Study, Vehicle Tracking,
Vehicle Location, Vehicle Maintenance and Mobile Repair.

**Platform** — Banner management for the home carousel, Offline Sync with a local/online toggle,
WhatsApp messaging, and an in-app User Guide that renders the bundled employee manuals.

## Tech stack

| | |
|---|---|
| Framework | Expo SDK ~50, React Native 0.73.6 |
| Navigation | React Navigation 6 (stack + tabs) |
| State | zustand — stores for `auth`, `box`, `currency`, `product` |
| Styling | NativeWind (Tailwind for React Native) |
| Networking | axios, plus the Odoo layer in [src/api/](src/api/) |
| Device | expo-camera, expo-barcode-scanner, expo-location, expo-print, react-native-maps |
| Testing | Jest |

## Odoo backend

Install these custom modules on the Odoo server the app connects to. All of them ship in
[odoo_modules/](odoo_modules/).

| Module | Purpose |
|---|---|
| `mobile_sales_order` | Mobile app sales order with one-click invoice and delivery |
| `mobile_invoice_report` | Custom PDF invoice report matching the mobile app invoice format |
| `easy_sales` / `easy_purchase` | One-click sales / purchase entry with payment modes and barcode printing |
| `estimate_sale` / `estimate_purchase` | One-click estimate / proforma entry without tax |
| `quick_sales_return` / `quick_purchase_return` | POS-style returns for small businesses |
| `sale_cost_protection` | Protect against below-cost sales with authorized-person approval |
| `gross_profit_report` | Product, salesperson and company-wise gross profit analysis |
| `credit_management_system` | Advanced credit management with WhatsApp & email approval |
| `partner_ledger_dynamic` | Adds a Generate Report button to the Partner Ledger wizard |
| `payment_mandatory` | Makes customer and amount mandatory in customer payments |
| `payment_signature_location` | Add customer signature and GPS location to payments |
| `transaction_auditing` | Transaction auditing from the mobile app |
| `pos_negative_stock` | Allow POS sales when stock is zero or negative |
| `product_enquiry` | Product enquiry management |
| `offline_sync` | Local/online data toggle with sync, delete and cross-check |
| `app_banner` | Manage home screen banner images for the mobile app |
| `staff_tracking` / `user_tracking` | Staff check-in/out and live location tracking |
| `hr_wfh_request` | WFH request with manager approval + mobile check-in/check-out |
| `vehicle_maintenances` | Vehicle maintenance management |
| `whatsapp_neonize_server` | QR-based WhatsApp messaging inside Odoo using Neonize |

The attendance and fleet features additionally need the suite in
[odoo_modules/Attendance modules/](odoo_modules/Attendance%20modules/):

| Module | Purpose |
|---|---|
| `hr_attendance_late` | Late arrivals, grace periods, half-day Fridays, holidays, waivers and salary deductions |
| `hr_field_attendance` | Field-based attendance from vehicle trips and customer visits |
| `hr_leave_request` | Employee leave requests with approval |
| `hr_employee_report` | Employee monthly report |
| `employee_device` | Register and manage employee devices for attendance verification |
| `customer_visit` | Customer visit tracking and visit plan management |
| `vehicle_tracking` | Vehicle movement, trips and driver logs with AI fraud detection |
| `vehicle_location` | Vehicle location |
| `hr_fleet` | History of cars driven by employees |

## Getting started

**Prerequisites** — Node.js 18+, npm, and either the [Expo Go](https://expo.dev/go) app or
Android Studio / Xcode for a native build.

```bash
npm install
npx expo start
```

Press `a` for Android, `i` for iOS, or scan the QR code with Expo Go.

On first launch, enter the Odoo server URL and your credentials on the login screen. The URL is
saved to device storage (`odoo_base_url` via AsyncStorage) and reused on every later launch —
see [src/api/config/odooConfig.js](src/api/config/odooConfig.js). The REST endpoint used by some
features is set separately in [src/api/config/apiConfig.js](src/api/config/apiConfig.js).

Run the test suite with `npm test` (or `npm run test:coverage`).

## Multi-brand builds

`app.json` is generated rather than hand-edited. [generateAppJson.js](generateAppJson.js) reads
`EXPO_PUBLIC_APP_NAME` and looks the brand up in
[src/utils/config/getConfig.js](src/utils/config/getConfig.js), which resolves the app name,
Android package and EAS project ID from `.env`. Four variants are wired up today: UAE, Oman,
UAE Test and Alphalize.

```bash
EXPO_PUBLIC_APP_NAME=<brand> npm run generate-app-json
```

## Building

Builds go through [EAS](https://docs.expo.dev/build/introduction/). Profiles live in
[eas.json](eas.json):

```bash
eas build -p android --profile preview      # APK
eas build -p android --profile preview4     # internal distribution
eas build -p android --profile production
```

Current release: **v1.0.88**, Android package `com.danat.alphalize`.

## Project structure

```
src/
  api/            Odoo + REST layer — config/, endpoints/, services/, uploads/, utils/
  components/     Shared UI — CRM, KPI, Calendar, Scanner, TSPLPrinter, SignaturePad, ...
  screens/        Splash, Auth, Home (40 Options plus Customer/Employee/Services Sections),
                  Products, Categories, Cart, MyOrders, Dashboard, KPIDashboard, Profile
  navigation/     AppNavigator.js, StackNavigator.js
  stores/         zustand stores: auth, box, currency, product
  services/       AttendanceService.js, CacheWarmer.js and friends
  data/           employeeManuals.js — generated index for the in-app User Guide
  hooks/ utils/ constants/
assets/           icons, fonts, images, animations, and manuals/ (PDFs bundled into the app)
odoo_modules/     the Odoo modules this app depends on
documents/        user manuals — App documents/ and Module documents/
android/          native project
```

## Documentation

- [documents/App documents/](documents/App%20documents/) — employee manuals for office
  attendance, field attendance, leave requests and late-waiver requests (`.docx` + `.pdf`).
- [documents/Module documents/](documents/Module%20documents/) — Odoo-side manuals for the
  attendance, device, leave and monthly-report modules.
- [assets/manuals/](assets/manuals/) — the same employee manuals bundled into the app and served
  by the in-app User Guide.
- [PLAN.md](PLAN.md) — design notes for the WFH + office attendance flow.
- [docs/legacy-README.md](docs/legacy-README.md) — the previous documentation, kept for reference.

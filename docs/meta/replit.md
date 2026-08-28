# Yaro FleetOS - Fleet Management System

## Overview
Yaro FleetOS is a comprehensive fleet management and CMMS (Computerized Maintenance Management System) platform designed for heavy vehicle fleet operations. Its primary purpose is to optimize fleet operations, manage maintenance, and control costs through features like vehicle tracking, maintenance scheduling, parts management, fuel monitoring, and extensive reporting. The project aims to serve key clients such as MAERSK and CNPCC, enhancing efficiency and reducing operational expenditures.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript
- **UI/UX**: Radix UI components with shadcn/ui styling, Tailwind CSS
- **State Management**: TanStack React Query
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite
- **Design Principles**: Modular design with dedicated layers for API calls (services), state/error handling (hooks), and role-based dashboards.

### Backend
- **Runtime**: Node.js 20 with TypeScript
- **Framework**: Express.js, using a modular router pattern and separate services for business logic.
- **Authentication**: Session-based with bcryptjs for password hashing. All authentication endpoints use bcrypt.hash with cost factor 10, with backward-compatible migration for legacy SHA-256 passwords.
- **File Management**: Multer for uploads, Archiver and XLSX for data export.

### Database
- **Primary Database**: PostgreSQL 16 (Neon serverless)
- **ORM**: Drizzle ORM
- **Schema Management**: Drizzle Kit for migrations.
- **Advanced Features**: Connection pooling, automated triggers for status updates and KPI calculations, and PostgreSQL advisory locks for critical operations like invoice auto-numbering.

### Core Modules & Features
- **Vehicle Management**: Tracking, status updates, acquisition workflow.
- **Maintenance Management (CMMS)**: Preventive scheduling, work order management, parts requirement handling, PDF export with official header.
- **Parts Inventory**: Stock management, categorization, supplier integration.
- **Fuel Management**: Rechargeable fuel card system, consumption tracking, anomaly detection.
- **Tire Management**: Inventory tracking, rotation scheduling, lifecycle management.
- **Alert System**: Automated notifications for maintenance, fuel anomalies, document expirations, and overdue supplier invoices (Critique, Urgent, En retard categories).
- **User Management**: Role-based Access Control (RBAC) supporting admin, workshop manager, technician, secretary, logistics, warehouse, and client roles, with self-service profile management.
- **Document Management**: Secure storage, version control, expiration tracking. Integrated documentation export in Reports page with user guide and test scenarios available as PDF with official branding.
- **Operations Management**: Client mission tracking and statistics, including dedicated client invoicing analytics dashboard. Mission details include placeholder tab for future print functionality.
- **Client Billing**: Automated invoice generation (FACT-YYYYMMDD-XXX format with concurrency control), 19.25% VAT, multi-step payment tracking, and PDF generation.
- **Data Export**: Automated Excel exports for various datasets. PDF exports for work orders and documentation with company header (TAY-header-final.png).
- **Procurement & Suppliers**:
    - **Supplier Management**: CRUD, performance ratings, contact management, search, filtering, and analytics.
    - **Grouped Purchase Orders**: Automatic grouping by supplier for cost optimization, with workflow, traceability, and temporal optimization.
    - **Delivery Alert System**: Proactive notifications for overdue orders, mandatory delivery codes.
    - **Three-Way Invoice Matching**: Automated validation of supplier invoices against purchase orders for amounts and quantities, with intelligent escalation for variances. Supports bulk import via Excel with validation and detailed error reporting.

### Deployment Strategy
- **Production Build**: Frontend (Vite static assets), Backend (ESBuild compiled Node.js), Automated Drizzle Kit migrations.
- **Environment**: Neon serverless for production.
- **Monitoring**: Activity logging, automated alerts, Excel data exports, real-time KPI calculations.
- **Production Data Seeding**: Consolidated script (`scripts/seed-production-data.ts`) imports real data from Excel files for deployment initialization. Includes suppliers, vehicles, invoices, fuel records, and default users. Idempotent execution with conflict handling. Execute with: `npx tsx scripts/seed-production-data.ts`. See `scripts/README-SEEDING.md` for detailed documentation.

## External Dependencies

### Core
- `@neondatabase/serverless`: PostgreSQL connectivity
- `drizzle-orm`: ORM and query builder
- `bcryptjs`: Password hashing
- `express-session`: Session management
- `multer`: File upload
- `archiver`: Data compression
- `xlsx`: Excel file generation

### UI
- `@radix-ui/*`: Component library
- `@tanstack/react-query`: Server state management
- `@hookform/resolvers`: Form validation
- `class-variance-authority`: Styling utilities
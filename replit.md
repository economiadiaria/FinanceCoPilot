# Copiloto Financeiro da Economia Diária

## Overview
This project is a SaaS financial consultancy platform for individuals (Pessoa Física - PF) and businesses (Pessoa Jurídica - PJ). Developed with Node.js, Express, and React, it offers a comprehensive financial management system including cash flow, transaction categorization, an investment module, and report generation. The platform aims to provide intelligent insights and rebalancing suggestions to optimize financial health.

## User Preferences
I prefer detailed explanations.
Do not make changes to the folder `Z`.
Do not make changes to the file `Y`.

## System Architecture

### UI/UX Decisions
The user interface is built with Shadcn UI and Tailwind CSS, featuring a responsive design with a fixed-width sidebar, a maximum content width of 7xl, and a spacing system based on multiples of 2. Key components include an `AppSidebar` for navigation, a `ClientSelector` for managing clients, and a `ThemeToggle` for light/dark mode. Typography uses the Inter font with `tabular-nums` for financial figures, and a defined color palette for primary actions, success, destruction, and muted elements.

### Technical Implementations
- **Backend**: Node.js with Express.js.
- **Frontend**: React with TypeScript and Vite.
- **Database**: Replit Database (`@replit/database`) with a MemStorage fallback.
- **Authentication**: Session-based using `express-session` and `bcrypt` for password hashing, with session ID regeneration for security.
- **State Management**: TanStack Query (React Query) for data fetching and caching.
- **Routing**: Wouter for client-side navigation.
- **Data Parsing**: OFX-js for parsing bank OFX files.
- **Security**: SHA256 hashing for OFX file deduplication, robust error handling, and secure password practices.
- **Intelligent Heuristics**:
    - **PF**: Suggestions for spending reduction if "Lazer" exceeds 30% of outflows, and rebalancing advice if equity (RV) surpasses targets.
    - **PJ**: Recommendations for negotiating fees if they exceed 5% of revenue, and advice to invest idle cash if it exceeds 20% of revenue.

### Feature Specifications
- **User Management**: Registration, login, logout, and user profile management with role-based access.
- **Client Management**: Creation and updating of client profiles (PF/PJ).
- **Transaction Management**: Import via OFX files with deduplication, listing, and batch categorization.
- **Investment Module**: Manual position entry, allocation visualization, and rebalancing suggestions based on defined policies.
- **Reporting**: Generation and viewing of monthly financial reports in HTML format.
- **Policy Configuration**: Setting investment targets for PF (e.g., 50/30/20 rule) and cash policies for PJ (e.g., min/max allocation to specific asset classes, issuer percentage, duration).
- **Dashboard**: Displays key performance indicators (KPIs), intelligent insights, and recent transactions.

### System Design Choices
The application uses a modular folder structure, separating client (frontend), server (backend), and shared (schemas) code. Data models are strictly typed using TypeScript. API endpoints are protected by authentication middleware, ensuring resource ownership and secure access. The system is designed for a seamless user experience, including automatic redirection for unauthenticated users, clear success/error notifications, and a consistent display of financial data.

## External Dependencies
- **Replit Database**: Primary data storage solution.
- **bcrypt**: For password hashing.
- **express-session**: For session management and user authentication.
- **OFX-js**: For parsing OFX bank statements.
- **TanStack Query (React Query)**: For frontend data management.
- **Wouter**: For client-side routing.
- **Shadcn UI**: UI component library.
- **Tailwind CSS**: Utility-first CSS framework.
- **Google Fonts (Inter)**: Typography.
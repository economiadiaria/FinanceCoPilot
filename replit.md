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
- **User Management**: Registration, login, logout, and user profile management with role-based access. Clients are automatically associated with creating users.
- **Client Management**: Creation and updating of client profiles (PF/PJ).
- **Transaction Management (PF)**: Import via OFX files or Open Finance sync with deduplication, listing, and batch categorization.
- **Open Finance Integration**: Connect banks via Pluggy API for automatic data synchronization. Supports simulated mode when API credentials are unavailable. Fetches accounts, transactions, and investment positions with automatic deduplication using providerTxId/providerPosId.
- **Investment Module**: Manual position entry or automatic sync via Open Finance, allocation visualization, and rebalancing suggestions based on defined policies.
- **Reporting**: Generation and viewing of monthly financial reports in HTML format.
- **Policy Configuration**: Setting investment targets for PF (e.g., 50/30/20 rule) and cash policies for PJ (e.g., min/max allocation to specific asset classes, issuer percentage, duration).
- **Dashboard (PF)**: Displays key performance indicators (KPIs), intelligent insights, and recent transactions.
- **PJ Sales Management**: Manual sales entry and CSV import with multi-payment support (one sale with multiple payment legs), settlement plan configuration (D+X, D+30_por_parcela, D+1), automatic deduplication based on saleId+parcelN.
- **PJ Bank Reconciliation**: OFX import with SHA256 deduplication, automatic matching of bank transactions to sale legs based on value+date, manual confirmation of matches, retroactive/prospective learning.
- **PJ Intelligent Categorization**: Pattern-based rules (exact/contains/startsWith), retroactive application to existing transactions, prospective application during OFX imports, automatic learning.
- **PJ Dashboard**: Displays business KPIs (revenue, costs, profit), Chart.js visualizations (trends, revenue split, top costs), sales metrics (total sales, average ticket, conversion rate), DFC (Demonstrativo de Fluxo de Caixa).

### System Design Choices
The application uses a modular folder structure, separating client (frontend), server (backend), and shared (schemas) code. Data models are strictly typed using TypeScript. API endpoints are protected by authentication middleware, ensuring resource ownership and secure access. The system is designed for a seamless user experience, including automatic redirection for unauthenticated users, clear success/error notifications, and a consistent display of financial data.

## External Dependencies
- **Replit Database**: Primary data storage solution.
- **bcrypt**: For password hashing.
- **express-session**: For session management and user authentication.
- **OFX-js**: For parsing OFX bank statements.
- **Pluggy API**: Open Finance integration for automatic bank data synchronization (optional, falls back to simulated mode).
- **Axios**: HTTP client for API requests.
- **TanStack Query (React Query)**: For frontend data management.
- **Wouter**: For client-side routing.
- **Shadcn UI**: UI component library.
- **Tailwind CSS**: Utility-first CSS framework.
- **Google Fonts (Inter)**: Typography.
- **Chart.js**: Interactive charts for PJ dashboard visualizations (loaded via CDN).
- **PapaParse**: CSV parsing for sales import.

## Open Finance Integration Details

### Configuration
Set the following environment secrets to enable real Open Finance sync:
- `PLUGGY_CLIENT_ID`: Your Pluggy client ID
- `PLUGGY_CLIENT_SECRET`: Your Pluggy client secret
- `PLUGGY_API_URL`: Pluggy API endpoint (e.g., https://api.pluggy.ai)
- `PLUGGY_WEBHOOK_SECRET`: Shared secret used to validate incoming Pluggy webhooks (sent in the `x-pluggy-signature` header)

Without these credentials, the system operates in **simulated mode**, creating fake data for testing.

### API Endpoints
- `POST /api/openfinance/consent/start`: Initiates bank connection (returns connect token or simulated mode flag)
- `POST /api/openfinance/webhook`: Receives Pluggy webhook events
- `POST /api/openfinance/sync`: Syncs accounts, transactions, and positions from connected banks
- `GET /api/openfinance/items`: Lists all connected bank items for a client

### Data Deduplication
Transactions and positions use `providerTxId` and `providerPosId` respectively to prevent duplicates during sync operations.

### Simulated Mode
When Pluggy credentials are not configured:
- Creates fake "Banco Simulado" institution
- Generates 1 checking account with BRL 5,000 balance
- Creates 3 sample transactions (salary, supermarket purchase, PIX transfer)
- Adds 1 investment position (Tesouro Selic 2027, RF class, BRL 10,000)

### Frontend UI
Access via `/open-finance` page to:
- Connect new banks (initiates Pluggy widget or simulated flow)
- Sync data from connected banks
- View connection status and last sync timestamps
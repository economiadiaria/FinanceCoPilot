# Design Guidelines: Copiloto Financeiro da Economia Diária

## Design Approach

**Selected Approach**: Design System with Financial Dashboard References

Drawing inspiration from Stripe Dashboard's clarity, QuickBooks' data organization, and Linear's modern minimalism. This financial SaaS demands trust, efficiency, and data-dense layouts that remain scannable and actionable.

**Core Principles**:
- Data transparency and hierarchy
- Progressive disclosure for complex operations
- Trustworthy, professional aesthetic
- Efficiency-first interactions

---

## Typography System

**Font Families** (Google Fonts):
- Primary: Inter (UI text, body, labels)
- Numeric: Tabular Nums variant of Inter (financial data, tables)
- Headings: Inter SemiBold/Bold

**Type Scale**:
- Page Titles: text-3xl font-bold (30px)
- Section Headers: text-2xl font-semibold (24px)
- Card Titles: text-lg font-semibold (18px)
- Body Text: text-base (16px)
- Secondary/Meta: text-sm (14px)
- Numeric Data: text-lg font-medium tabular-nums (18px)
- Small Labels: text-xs uppercase tracking-wide (12px)

**Hierarchy Rules**:
- Financial values always use tabular-nums for alignment
- Positive/negative amounts differentiated by prefix (+ / −) and visual treatment
- Labels use uppercase text-xs with letter-spacing for clear categorization

---

## Layout System

**Spacing Primitives**: Tailwind units of 2, 4, 6, 8, 12, 16, 20

**Common Patterns**:
- Section padding: py-8 to py-12
- Card padding: p-6
- Grid gaps: gap-6
- Element spacing: space-y-4 for vertical stacking
- Tight groupings: space-y-2
- Container max-width: max-w-7xl

**Grid Structure**:
- Dashboard: 12-column grid for flexible layouts
- Sidebar navigation: Fixed 256px width (w-64)
- Main content area: Fluid with max-w-7xl container
- Cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 for metrics
- Tables: Full-width with horizontal scroll on mobile

---

## Component Library

### Navigation

**Top Bar** (fixed, full-width):
- Height: h-16
- Logo left, user menu right
- Client selector dropdown (PF/PJ toggle)
- Padding: px-6
- Border bottom for separation

**Sidebar** (fixed left, desktop only):
- Width: w-64
- Navigation items with icons (from Heroicons)
- Active state: full-width highlight bar
- Sections: Dashboard, Transações, Investimentos, Relatórios, Configurações
- Collapsed on mobile to hamburger menu

### Dashboard Cards

**Metric Cards** (KPI display):
- Padding: p-6
- Border radius: rounded-lg
- Structure: Label (text-sm) + Value (text-3xl tabular-nums) + Change indicator
- Grid: 3-column on desktop, 1-column mobile
- Height: min-h-32 for consistency

**Chart Cards**:
- Padding: p-6
- Header: title + period selector + export button
- Chart area: min-h-80
- Use placeholder comments for chart libraries (<!-- Chart.js: Line Chart -->)

### Tables

**Transaction Table**:
- Full-width with rounded-lg container
- Header: sticky top with background
- Columns: Date (w-32) | Description (flex-1) | Category (w-40) | Amount (w-32 text-right)
- Row height: h-14
- Zebra striping for readability
- Hover state for rows
- Checkbox column for bulk actions (w-12)
- Mobile: Card-based layout with stacked fields

**Data Table Patterns**:
- Right-align numeric columns
- Use tabular-nums for amount columns
- Category badges with subtle backgrounds
- Action buttons in rightmost column
- Pagination footer with items per page selector

### Forms

**Input Fields**:
- Height: h-12
- Padding: px-4
- Border radius: rounded-lg
- Label positioning: above with mb-2
- Helper text: text-sm below input
- Error states: border treatment + error message

**CSV Upload Area**:
- Drag-and-drop zone: min-h-48
- Dashed border when empty
- File icon + instruction text centered
- File preview after upload with filename + size

**Categorization Interface**:
- Split view: Transaction list (left 60%) | Category selector (right 40%)
- Quick action buttons: "Marcar como Receita", "Custo Fixo", "Custo Variável"
- Bulk selection with count indicator
- Apply button: prominent, disabled until selection made

### Buttons

**Primary Actions**:
- Height: h-12
- Padding: px-6
- Border radius: rounded-lg
- Font: text-base font-semibold
- Examples: "Importar CSV", "Gerar Relatório", "Salvar"

**Secondary Actions**:
- Height: h-10
- Padding: px-4
- Border radius: rounded-lg
- Font: text-sm font-medium
- Examples: "Cancelar", "Exportar"

**Icon Buttons** (tables, cards):
- Size: w-10 h-10
- Border radius: rounded-lg
- Icon size: w-5 h-5
- Tooltips on hover

### Modals & Overlays

**Modal Structure**:
- Max-width: max-w-2xl
- Padding: p-8
- Border radius: rounded-xl
- Header: text-2xl font-bold mb-6
- Footer: buttons right-aligned with gap-4
- Close button: top-right absolute

**Notification Toast**:
- Position: fixed top-4 right-4
- Width: w-96
- Padding: p-4
- Border radius: rounded-lg
- Auto-dismiss after 5s
- Success/Error/Info variants

### Investment Module

**Position Cards**:
- Grid: grid-cols-1 lg:grid-cols-2 gap-6
- Card padding: p-6
- Structure: Asset name (bold) + Class badge + Allocation percentage + Current value (large, tabular-nums)
- Metadata grid: 2 columns for Rate, Liquidity, Maturity

**Allocation Donut Chart**:
- Size: w-64 h-64 centered
- Legend: Right-side with percentages
- Target vs Actual comparison bars below

**Rebalance Suggestions**:
- Table format with columns: Classe | Atual | Meta | Diferença | Ação Sugerida
- Action column uses clear directional language ("Comprar R$ 5.000", "Vender R$ 2.000")

### Reports

**Report Header**:
- Client name + Period (large, bold)
- Generation date (text-sm)
- Export/Print buttons in top-right

**Report Sections**:
- Each section: mb-12
- Section title: text-xl font-bold mb-6
- Content: Mix of metric grids, tables, and chart placeholders
- Notes section: Textarea-style display for custom observations

**Print Optimization**:
- Hide navigation and action buttons
- Expand all collapsed sections
- Page break hints between major sections

---

## Page Layouts

### Dashboard (Home)
- Top metrics: 3-column grid (Receita, Lucro, Margem)
- Revenue trend: Line chart card
- Recent transactions: Table (last 10)
- Quick actions: Card with icon buttons

### Transações
- Filter bar: Date range + Category + Status dropdown
- Bulk action toolbar (appears on selection)
- Transaction table with pagination
- Floating action button: "Importar CSV"

### Investimentos
- Summary cards: Total alocado + Diversificação score
- Allocation chart + target comparison
- Positions grid
- Rebalance suggestions (collapsible section)

### Relatórios
- Period selector tabs (last 6 months)
- Report preview iframe
- Sidebar: Archive of past reports

### Configurações
- Tabbed interface: Perfil | Políticas | Segurança
- Policy editor for PF targets and PJ cash policy
- Form-based with real-time validation

---

## Responsive Behavior

**Breakpoints**:
- Mobile: < 640px (single column, hamburger menu)
- Tablet: 640-1024px (2-column grids, visible sidebar)
- Desktop: > 1024px (3-column grids, full layout)

**Mobile Adaptations**:
- Tables convert to card lists
- Multi-column grids stack to single column
- Sidebar collapses to overlay menu
- Reduced padding (p-4 instead of p-6)
- Bottom navigation bar for primary actions

---

## Icons

**Library**: Heroicons (via CDN)

**Usage**:
- Navigation: 24px icons with labels
- Buttons: 20px icons, left-aligned with text
- Metric cards: 32px icons, subtle treatment
- Table actions: 16px icons only
- Categories: Consistent icon per category type (Currency for Receita, Shopping Cart for Custos, etc.)

---

## Animations

**Minimal, purposeful motion**:
- Page transitions: None (instant navigation)
- Modal entry: Fade in (150ms)
- Hover states: Subtle background shift (no transform)
- Loading states: Spinner only, no skeleton screens
- Chart rendering: Animate on first load only (300ms ease)

---

## Data Visualization

**Chart Types**:
- Revenue trends: Line charts
- Category breakdown: Donut/Pie charts  
- Monthly comparison: Grouped bar charts
- Investment allocation: Stacked bar or donut

**Chart Styling**:
- Grid lines: Subtle, minimal
- Tooltips: Rounded, shadow, clear typography
- Legend: Horizontal below chart
- Axis labels: text-sm

---

## Accessibility

- All interactive elements: min 44x44px touch target
- Form inputs: Associated labels with for attribute
- Error messages: aria-live announcements
- Keyboard navigation: Focus visible on all controls
- Skip to main content link
- High contrast ratios for all text

---

## Images

**No large hero images** - This is a utility dashboard application focused on data and efficiency. Visual hierarchy comes from typography, whitespace, and data presentation rather than decorative imagery.

**Icons only**: Use icon sets consistently throughout for navigation, categories, and actions. No photography or illustrations needed for this financial tool interface.
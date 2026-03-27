# Tools and Techniques Guide

## Software, Setup, and Workflows for A2A Arbitrage

This guide covers every tool in your A2A toolkit, how to configure each one for maximum effectiveness, and the daily workflows that tie them together.

---

## Keepa: Your Primary Analysis Tool

Keepa is the most important tool in A2A arbitrage. It tracks Amazon price history, sales rank history, seller counts, and deal alerts. You will use it constantly.

### Keepa Deals Page

The Deals page shows products with recent price drops, filtered by your criteria. This is your primary scanning tool for reactive sourcing.

#### Recommended Deals Filter Configuration

| Setting | Value | Why |
|---------|-------|-----|
| **Price drop %** | 30% or greater | Filters minor fluctuations; focuses on actionable drops |
| **Time window** | Within last 24 hours | Fresh opportunities only; older deals are likely picked over |
| **Sales rank** | 200,000 or less | Broad enough to find deals, narrow enough to ensure demand |
| **Seller type** | Amazon (as a seller) | Confirms this is Amazon's own inventory at the dropped price |
| **Condition** | New | A2A requires new condition for resale |
| **Minimum ROI** | 10% or higher | Basic profitability floor (aim higher, but don't miss borderline deals) |
| **Minimum price** | $15 | Below $15, FBA fees consume too much margin |
| **Maximum price** | $150 (adjust to your capital) | Keeps individual investments within your risk tolerance |
| **Categories** | Select 3-5 you know well | Focus beats breadth when scanning |

#### Saving and Loading Deal Filters

1. Configure your filters on the Keepa Deals page
2. Click "Save" and name the filter preset (e.g., "A2A Reactive - Standard")
3. Create 2-3 filter variations for different strategies:
   - **Wide Net:** Drop 20%+, rank 300k, all categories — for slower scanning sessions
   - **High ROI:** Drop 50%+, rank 100k, core categories — for quick high-value scans
   - **Specific Category:** Drop 30%+, rank 200k, single category — deep dive into one category

### Keepa Product Finder

The Product Finder is an advanced search tool for identifying products that match specific criteria. Use it primarily for proactive restock candidate identification.

#### Product Finder Settings for Restock Candidates

| Parameter | Setting | Purpose |
|-----------|---------|---------|
| Amazon out of stock % (90 days) | 10-50% | Products frequently OOS but not discontinued |
| Current Amazon status | In Stock | Currently available to purchase |
| Current sales rank | Under 50,000 | Strong demand |
| 90-day average rank | Under 75,000 | Consistent demand through OOS cycles |
| Current Amazon price | $15-$100 | A2A sweet spot |
| Number of FBA sellers | Under 10 | Less competition |
| Review count | 50+ | Established product with proven demand |
| Rating | 3.5+ stars | Lower return risk |

### Keepa Price Tracking Alerts

Set alerts to notify you when a product's price crosses a threshold. Critical for proactive restock and seasonal hold strategies.

#### Setting Up an Alert

| Step | Action |
|------|--------|
| 1 | Navigate to the product's Keepa page |
| 2 | Click "Track this product" (or the tracking bell icon) |
| 3 | Select "Amazon" as the price type to track |
| 4 | Enter your target price (your maximum buy price for profitable ROI) |
| 5 | Choose alert delivery: email, Telegram, or browser notification |
| 6 | Set tracking duration: "Until triggered" for one-time, or "Indefinitely" for restock monitoring |
| 7 | Save the alert |

#### Alert Management Best Practices

| Practice | Details |
|----------|---------|
| **Review alerts weekly** | Remove alerts for products you no longer want to track |
| **Use descriptive notes** | Add your max buy price and expected ROI in the alert notes |
| **Set realistic thresholds** | Too tight = never triggers; too loose = alerts on unprofitable prices |
| **Monitor alert volume** | If you get 50+ alerts per day, your thresholds are too loose |
| **Ideal active alerts** | 50-150 for a part-time operation; 200-500 for full-time |

### Keepa Browser Extension

Install the Keepa browser extension to see price history charts directly on Amazon product pages.

#### Extension Value

| Feature | How It Helps |
|---------|-------------|
| **Price chart on every Amazon page** | Instantly see 3-month, 6-month, or 1-year price history without leaving Amazon |
| **Sales rank overlay** | See rank trends directly on the product page |
| **Quick access to full Keepa data** | One click to open the full Keepa analysis page |
| **Price type toggles** | Quickly compare Amazon price vs. 3P New vs. 3P Used prices |
| **Data export** | Export price/rank data for spreadsheet analysis |

---

## FlipAlert: Real-Time Deal and Restock Monitoring

FlipAlert is a specialized tool for Amazon arbitrage that provides real-time deal alerts, restock monitoring, and a lead database.

### Key FlipAlert Features for A2A

| Feature | Use Case | Setup |
|---------|----------|-------|
| **Real-time deal alerts** | Reactive sourcing — get notified of price drops faster than manual Keepa scanning | Configure alert criteria (category, price range, rank, ROI minimum) |
| **Restock monitoring** | Proactive restock — get notified when Amazon restocks a tracked product | Add ASINs to your restock watchlist |
| **Lead database** | Research — browse curated deals other users have found | Filter by category, ROI, rank |
| **Push notifications** | Speed — mobile alerts for immediate action | Enable push notifications on phone |

### FlipAlert Configuration for A2A

| Setting | Recommended Value |
|---------|------------------|
| **Alert categories** | Match your Keepa Deals categories |
| **Minimum ROI** | 15% (slightly higher than Keepa to reduce noise) |
| **Maximum rank** | 150,000 |
| **Minimum price** | $15 |
| **Alert frequency** | Real-time (not digest) |
| **Notification method** | Push notification + email |

### Using FlipAlert and Keepa Together

| Scenario | Primary Tool | Secondary Tool |
|----------|-------------|----------------|
| Daily deal scanning | Keepa Deals page | FlipAlert alerts as backup |
| Restock monitoring | FlipAlert restock alerts | Keepa price tracking alerts |
| Deep product analysis | Keepa (full charts, data) | FlipAlert (quick ROI estimate) |
| Mobile monitoring | FlipAlert (better mobile experience) | Keepa alerts (email) |

---

## FBA Fee Calculator

### Amazon's Revenue Calculator

Amazon provides a free FBA Revenue Calculator that shows exact fees for any ASIN. This is your definitive source for fee calculations.

#### How to Use the FBA Calculator

| Step | Action |
|------|--------|
| 1 | Go to Seller Central > Pricing > Revenue Calculator (or search "FBA Revenue Calculator" on Amazon) |
| 2 | Enter the ASIN or product name |
| 3 | The calculator auto-populates the product details |
| 4 | Enter your "Item Price" (your expected sell price) |
| 5 | Enter your "Ship to Amazon" cost (per-unit inbound shipping cost) |
| 6 | Enter your "Product Cost" (your buy price per unit) |
| 7 | Review the fee breakdown and net profit |

#### Understanding the Fee Breakdown

| Fee Component | What It Is | Typical Range |
|---------------|-----------|---------------|
| **Referral fee** | Amazon's commission per sale (percentage of sale price) | 8-15% depending on category |
| **Fulfillment fee** | FBA pick, pack, and ship fee | $3.22-$10+ depending on size/weight |
| **Monthly storage** | Cost to store item in Amazon warehouse per month | $0.87-$2.40 per cubic foot |
| **Long-term storage** | Additional fee for items stored over 181 days | $6.90/cubic ft or $0.15/unit |
| **Variable closing fee** | Additional fee on media items (books, DVDs, etc.) | $1.80 per unit |

#### Quick Fee Estimation by Price Point

| Sell Price | Approximate Total FBA Fees | Approximate Net (before COGS) |
|-----------|--------------------------|------------------------------|
| $10 | $5.00-$6.00 (50-60%) | $4.00-$5.00 |
| $15 | $6.00-$7.50 (40-50%) | $7.50-$9.00 |
| $20 | $7.00-$9.00 (35-45%) | $11.00-$13.00 |
| $30 | $9.00-$12.00 (30-40%) | $18.00-$21.00 |
| $50 | $13.00-$18.00 (26-36%) | $32.00-$37.00 |
| $75 | $17.00-$25.00 (23-33%) | $50.00-$58.00 |
| $100 | $22.00-$32.00 (22-32%) | $68.00-$78.00 |

**Key insight:** As sell price increases, FBA fees as a percentage decrease. This is why higher-priced items often yield better ROI in A2A.

---

## Tracking Spreadsheet

### What to Track

Every A2A purchase and sale should be logged in a tracking spreadsheet. This is your business ledger, your performance analysis tool, and your documentation backup.

#### Required Columns

| Column | Data Type | Purpose |
|--------|-----------|---------|
| **ASIN** | Text | Product identifier |
| **Product Name** | Text | Quick reference |
| **Category** | Text | For category-level analysis |
| **Pillar** | Dropdown: Reactive / Debundle / Seasonal / Restock | Track which strategy |
| **Purchase Date** | Date | When you bought it |
| **Purchase Price (per unit)** | Currency | Your cost basis |
| **Tax Paid (per unit)** | Currency | Sales tax on purchase |
| **Quantity** | Number | How many units |
| **Total Investment** | Formula: (Price + Tax) x Quantity | Total capital deployed |
| **Source Order ID** | Text | Amazon order number from buying account |
| **Invoice Saved?** | Yes/No | Documentation verification |
| **Expected Sell Price** | Currency | Your target sell price based on analysis |
| **FBA Fees (estimated)** | Currency | From FBA Calculator |
| **Expected Profit (per unit)** | Formula | Expected Sell - FBA Fees - Purchase - Tax |
| **Expected ROI** | Formula | Expected Profit / (Purchase + Tax) x 100 |
| **FBA Shipment Date** | Date | When you shipped to Amazon warehouse |
| **FBA Shipment ID** | Text | Amazon shipment tracking |
| **Date Listed** | Date | When inventory became active on Amazon |
| **Actual Sell Price** | Currency | What it actually sold for |
| **Actual FBA Fees** | Currency | Fees charged on the sale |
| **Actual Profit (per unit)** | Formula | Actual Sell - Actual Fees - Purchase - Tax |
| **Actual ROI** | Formula | Actual Profit / Total Cost x 100 |
| **Days to Sell** | Formula | Date Sold - Date Listed |
| **Status** | Dropdown: Purchased / In Transit / At FBA / Listed / Sold / Returned / Liquidated | Current status |
| **Notes** | Text | Lessons learned, issues encountered |

#### Summary Dashboard Metrics

Build a summary tab that auto-calculates:

| Metric | Formula/Source |
|--------|---------------|
| **Total invested (current month)** | Sum of Total Investment for current month |
| **Total profit (current month)** | Sum of Actual Profit for current month |
| **Average ROI** | Average of Actual ROI for completed flips |
| **Best performing pillar** | Pillar with highest average ROI |
| **Average days to sell** | Average of Days to Sell for completed flips |
| **Win rate** | (Profitable flips / Total completed flips) x 100 |
| **Capital deployed (current)** | Sum of investment in unsold inventory |
| **Inventory at FBA (units)** | Count of items with status "At FBA" or "Listed" |

---

## Browser Setup and Workflow

### Recommended Browser Configuration

| Browser | Purpose | Extensions |
|---------|---------|------------|
| **Chrome (Profile 1)** | Keepa scanning, analysis, FBA Calculator | Keepa extension, Amazon Seller extension |
| **Chrome (Profile 2) or Firefox** | Sourcing buying account | Keepa extension (for quick price checks on product pages) |
| **Seller Central** | Manage listings, shipments, account health | N/A (use within Chrome Profile 1) |

### Tab Layout for Scanning Sessions

| Tab Position | Page | Purpose |
|-------------|------|---------|
| Tab 1 | Keepa Deals (with saved filter) | Primary scanning |
| Tab 2 | FBA Revenue Calculator | Quick fee calculations |
| Tab 3 | Tracking spreadsheet | Logging purchases |
| Tab 4 | Seller Central (Add a Product) | Gating checks |
| Tab 5 | Amazon sourcing account | Making purchases |
| Tab 6-10 | Open as needed | Individual product Keepa pages for deep analysis |

### Keyboard Shortcuts for Speed

| Action | Shortcut | Purpose |
|--------|----------|---------|
| Open new tab | Ctrl/Cmd + T | Quick access to new product pages |
| Close tab | Ctrl/Cmd + W | Clean up after analysis |
| Switch tabs | Ctrl/Cmd + Tab | Navigate between analysis tools |
| Refresh page | F5 or Ctrl/Cmd + R | Refresh Keepa Deals for new results |
| Back | Alt/Cmd + Left Arrow | Return to deals list from product page |
| Find on page | Ctrl/Cmd + F | Search for specific text on Keepa pages |
| Bookmark | Ctrl/Cmd + D | Save a promising product for later |

---

## Time Management

### Best Times to Scan for Deals

| Time Window (ET) | Quality | Competition | Notes |
|-----------------|---------|-------------|-------|
| **6:00-8:00 AM** | High | Low | Overnight algorithmic repricing creates fresh drops; few scanners active |
| **11:00 AM-1:00 PM** | Medium-High | Medium | Lightning deals and daily deals launch |
| **3:00-5:00 PM** | Medium | Medium-High | Afternoon clearance adjustments |
| **9:00-11:00 PM** | High | Low | End-of-day clearance, less competition |
| **Weekday mornings** | Higher than weekends | Lower | More algorithmic activity on business days |

### Daily Schedule Template (Part-Time: 1-2 Hours/Day)

| Time | Activity | Duration |
|------|----------|----------|
| **Morning (6:30-7:00 AM)** | Quick Keepa Deals scan with High ROI filter | 30 min |
| **Evening (9:00-9:45 PM)** | Full Keepa Deals scan with Standard filter | 45 min |
| **Evening (9:45-10:00 PM)** | Review FlipAlert notifications from the day | 15 min |

### Daily Schedule Template (Full-Time: 4-6 Hours/Day)

| Time | Activity | Duration |
|------|----------|----------|
| **6:00-7:00 AM** | Morning Keepa Deals scan (Standard filter) | 60 min |
| **7:00-7:30 AM** | Review and act on overnight FlipAlert notifications | 30 min |
| **9:00-10:00 AM** | Product research / restock watchlist building | 60 min |
| **11:00 AM-12:00 PM** | Lightning deal scan + FBA shipment prep | 60 min |
| **3:00-4:00 PM** | Afternoon scan + inventory management in Seller Central | 60 min |
| **9:00-10:00 PM** | Evening deals scan + daily tracking spreadsheet update | 60 min |

### Weekly Activities

| Day | Extra Activity |
|-----|---------------|
| **Monday** | Weekly inventory review in Seller Central; check stranded/unfulfillable |
| **Tuesday** | Restock watchlist maintenance (monthly on first Tuesday) |
| **Wednesday** | FBA shipment creation and prep for items received |
| **Thursday** | Pricing review — adjust any listings that need repricing |
| **Friday** | End-of-week tracking spreadsheet reconciliation |
| **Saturday** | Light scanning only; focus on FBA physical prep and shipping |
| **Sunday** | Week review: calculate profit, analyze performance, plan next week |

---

## Advanced Techniques

### Coupon and Deal Stacking

Sometimes Amazon products have multiple discounts that stack:

| Discount Type | How to Find | Stacking Potential |
|---------------|------------|-------------------|
| **Clippable coupons** | Orange "coupon" tag on product page | Stacks with most price drops |
| **Subscribe & Save** | Available on eligible consumables | 5-15% additional discount |
| **Promotional credit** | Amazon promotions ("spend $50, get $10") | Stacks with base price |
| **Lightning deal pricing** | Time-limited deals page | Already discounted; sometimes has coupons too |
| **Warehouse deals** | Amazon Warehouse section | Deep discounts on open-box (condition varies) |

**Warning:** Coupon stacking can trigger account scrutiny if done excessively. Use naturally and do not stack more than 2 discount types per order.

### Multi-Quantity Order Strategy

When buying multiple units of the same product:

| Quantity | Approach | Rationale |
|----------|----------|-----------|
| 1-5 units | Single order | Normal consumer behavior |
| 6-15 units | Split into 2-3 orders over 24-48 hours | Reduces per-order visibility |
| 16-30 units | Split into 3-5 orders over 3-5 days | Spread across multiple days |
| 30+ units | Carefully assess if worth the risk; split over 1-2 weeks | High volumes increase account flags |

### Price Comparison Across Amazon Marketplaces

Some products have different pricing on Amazon.com vs. Amazon.ca, Amazon.co.uk, etc. While cross-marketplace A2A adds complexity (international shipping, customs), it can uncover opportunities invisible to domestic-only scanners.

---

## Tool Cost Summary

| Tool | Cost | Essential? |
|------|------|-----------|
| **Keepa** (subscription) | ~$20/month | Yes — this is non-negotiable |
| **FlipAlert** | ~$30-50/month depending on plan | Highly recommended |
| **Amazon Seller account** (Professional) | $39.99/month | Yes — required to sell |
| **Tracking spreadsheet** | Free (Google Sheets) or paid (Excel) | Yes — use something |
| **Browser extensions** | Free (Keepa extension) | Yes |
| **FBA Revenue Calculator** | Free (Amazon tool) | Yes |
| **Total monthly overhead** | ~$90-$110/month | Break-even at ~$100/month profit |

# Amazon Advertising — Comprehensive Guide

## Overview

Amazon Advertising is a cost-per-click (CPC) advertising platform that allows sellers to promote their products and brands across Amazon's marketplace and beyond. You only pay when shoppers click your ads, and you control your spending through bids and budgets.

**Key stat:** Sellers using Sponsored Products saw **34% more sales growth** compared to those who did not, four weeks after adoption.

---

## Ad Types

### 1. Sponsored Products

**What they are:** CPC ads that promote individual product listings on Amazon and select premium apps and websites.

**Best for:** Driving direct product sales; recommended as the first advertising step for new advertisers.

**How they work:**
1. Select specific products to promote.
2. Choose targeting parameters (keywords or automatic targeting).
3. Set bids and daily budget.
4. When customers click an ad, they go directly to the product's detail page.
5. Ads only display when products are in stock.

**Placements:**
- Top of, alongside, or within shopping results.
- On product detail pages.
- Third-party destinations and Amazon-owned sites.
- Desktop browsers, mobile browsers, and Amazon mobile app.

**Targeting options:**

| Type | Description |
|------|-------------|
| **Automatic targeting** | Amazon's systems identify relevant keywords and products to target based on your listing content. Best for beginners and keyword discovery. |
| **Manual targeting — Keywords** | You select specific keywords. Match types: Broad, Phrase, and Exact. Gives more control over which searches trigger your ads. |
| **Manual targeting — Product** | Target specific products, categories, or brands. Your ads appear on those product detail pages or in searches related to those products. |

**Ad formats:**
- Standard product image ads.
- **Sponsored Products video** — long-form interactive video content highlighting product features.

**Key metrics to monitor:**
- **Impressions** — How many times your ad was shown.
- **Clicks** — How many times shoppers clicked your ad.
- **CTR (Click-Through Rate)** — Clicks / Impressions.
- **CPC (Cost Per Click)** — Average cost per click.
- **ACoS (Advertising Cost of Sales)** — Ad spend / Ad revenue. Lower is better. Formula: (Total Ad Spend / Total Ad Sales) x 100.
- **ROAS (Return on Ad Spend)** — Ad revenue / Ad spend. Higher is better. The inverse of ACoS.
- **Conversion Rate** — Orders / Clicks.

**New advertiser incentive:** Up to **$1,000 advertising credit** for Sponsored Products + **$50 coupon credit** (available during first 90 days).

---

### 2. Sponsored Brands

**What they are:** Brand-focused ads that showcase your brand logo, a custom headline, and multiple products in prominent placements.

**Best for:** Brand awareness, driving traffic to your Brand Store, launching new products.

**Eligibility:** Must be enrolled in Amazon Brand Registry.

**Ad formats:**

| Format | Description |
|--------|-------------|
| **Product Collection** | Showcase multiple products from your catalog with your brand logo and custom headline. Links to a product list page or Brand Store. |
| **Store Spotlight** | Feature your Brand Store subpages with custom images and labels. Drives traffic directly to your Store. |
| **Video** | Autoplay video ads that appear in search results. Links to a product detail page. Highly engaging format. |

**Placements:**
- Top of search results (most premium placement on Amazon).
- Within search results.
- On product detail pages.
- Amazon home page.
- Desktop and mobile devices.

**Key benefits:**
- Prominent top-of-search placement captures attention.
- Precise keyword and product targeting.
- AI-powered creative generation at no additional cost.
- Routes traffic to Brand Stores or product pages.
- Performance measurement with shopper engagement insights.

**Performance data:** Case studies show 80% new-customer sales attribution and 224% year-over-year impression growth for select advertisers.

---

### 3. Sponsored Display (Now "Display Ads")

**What they are:** Flexible display ad formats that reach relevant audiences across Amazon properties and the broader internet. Sponsored Display has been rebranded and unified into Amazon's wider display ads offering.

**Best for:** Retargeting shoppers who viewed your products, reaching audiences off-Amazon, competitor targeting.

**Eligibility:** Available to Professional sellers, vendors, and agencies.

**Placements:**
- Amazon product detail pages.
- Amazon properties (Twitch, Fire TV, Echo Show).
- Premium placements across the open internet (third-party websites and apps).

**Targeting approaches:**

| Type | Description |
|------|-------------|
| **Contextual targeting** | Reach shoppers browsing specific product categories or detail pages related to your products. |
| **Audience targeting** | Target audiences based on shopping signals — views, purchases, and interests. Includes retargeting of shoppers who viewed your products but did not purchase. |

**Creative options:**
- Amazon-generated creative (automatic).
- Custom creative assets you provide.

**Key change:** Sponsored Display is now part of Amazon's centralized hub that unifies sponsored ads and Amazon DSP workflows. Existing campaigns remain operational, and new campaigns should be created through the Display option in the standard campaign creation flow.

---

### 4. Brand Stores

**What they are:** Free multi-page storefronts on Amazon with a custom URL (amazon.com/yourbrand).

**Cost:** Free to create and maintain.

**Eligibility:** Professional selling account + Brand Registry enrollment.

**Key stats:**
- Store visitors purchase **53.9% more frequently**.
- Store visitors have a **71.3% higher average order value**.

**Features:**
- Drag-and-drop templates.
- Multiple pages and subpages.
- Rich media (video, images, product grids).
- Custom URL for external marketing.

---

### 5. Additional Ad Formats

- **Video Ads** — Streaming video advertising across Amazon properties (Fire TV, IMDb, Twitch, etc.).
- **Audio Ads** — Audio-based advertising on Amazon Music's ad-supported tier.
- **Out-of-Home Ads** — Physical location-based advertising (billboards, signage).
- **Amazon DSP (Demand-Side Platform)** — Programmatic buying for display, video, and audio ads across Amazon and third-party exchanges. Typically for larger advertisers.

---

## Campaign Structure Best Practices

### Account Organization
- **Campaigns** — Top level. Set daily budget and targeting strategy here.
- **Ad Groups** — Within campaigns. Group similar products together.
- **Ads** — Individual product ads within ad groups.

### Recommended Campaign Architecture
1. **Brand campaign** — Target your own brand name keywords (defensive strategy, low ACoS).
2. **Category campaign** — Target broad category keywords for discovery.
3. **Competitor campaign** — Target competitor brand and product keywords.
4. **Product targeting campaign** — Target specific ASINs (complementary or competitor products).
5. **Auto campaign** — Let Amazon discover new keywords, then move winners to manual campaigns.

---

## Keyword Research

### Methods
- **Automatic campaigns** — Run these first to discover which keywords Amazon matches to your products.
- **Search Term Report** — Download from Campaign Manager to see exact search terms that triggered your ads.
- **Brand Analytics — Search Query Performance** — Shows which keywords drive searches and sales in your category.
- **Competitor listings** — Review competitor titles, bullet points, and back-end keywords.
- **Amazon search bar suggestions** — Type partial keywords to see autocomplete suggestions.

### Match Types (for Manual Keyword Campaigns)
| Match Type | Behavior | Example Keyword | Triggers On |
|------------|----------|----------------|-------------|
| **Broad** | Widest reach; includes synonyms and related terms | "running shoes" | "best shoes for running," "running sneakers," "jogging shoes" |
| **Phrase** | Search must contain your phrase in order | "running shoes" | "best running shoes for men," "running shoes on sale" |
| **Exact** | Search must match exactly (with minor variations) | "running shoes" | "running shoes," "running shoe" |

### Negative Keywords
- Add irrelevant search terms as negative keywords to prevent wasted spend.
- Available as negative phrase or negative exact match.
- Review Search Term Reports regularly and add poor-performing terms as negatives.

---

## Bidding Strategies

### Bid Types
| Strategy | Description | Best For |
|----------|-------------|----------|
| **Dynamic bids — Down only** | Amazon lowers bids when a click is less likely to convert. Default setting. | Conservative approach, protecting budget. |
| **Dynamic bids — Up and down** | Amazon raises bids (up to 100%) when more likely to convert and lowers when less likely. | Aggressive growth, maximizing conversions. |
| **Fixed bids** | Amazon uses your exact bid without adjustments. | Full control, predictable spending. |

### Placement Adjustments
- Increase bids by up to **900%** for "Top of Search" placement.
- Increase bids for "Product Pages" placement.
- These are multipliers applied on top of your base bid.

---

## Budget Management

### Daily Budget
- Set at the campaign level.
- Amazon may exceed daily budget by up to 25% on high-traffic days but averages out over the month.
- Budget is not a hard cap but an average daily target.

### Budget Allocation Tips
- Start with at least $10-$20/day per campaign for meaningful data.
- Allocate more budget to top-performing campaigns.
- Monitor "budget capped" warnings — means your campaign ran out of budget before end of day.
- Use portfolio budgets to set spending caps across multiple campaigns.

---

## Key Metrics & Reporting

### Essential Metrics

| Metric | Formula | What It Tells You |
|--------|---------|-------------------|
| **ACoS** | (Ad Spend / Ad Sales) x 100 | Efficiency of ad spend. Target varies by margin and goal. |
| **ROAS** | Ad Sales / Ad Spend | Return on investment. Inverse of ACoS. |
| **TACoS** | (Ad Spend / Total Sales) x 100 | Ad spend relative to ALL sales (including organic). Shows true advertising dependency. |
| **Impressions** | N/A | Visibility and reach of your ads. |
| **CTR** | (Clicks / Impressions) x 100 | Ad relevance and appeal. Benchmark: 0.3-0.5% for Sponsored Products. |
| **CPC** | Total Spend / Total Clicks | Cost efficiency per click. |
| **Conversion Rate** | (Orders / Clicks) x 100 | How well your listing converts ad traffic. Benchmark: 10-15% for well-optimized listings. |

### Available Reports
- **Search Term Report** — Shows exact customer search terms that triggered your ads.
- **Targeting Report** — Performance by keyword or product target.
- **Placement Report** — Performance by ad placement (top of search, rest of search, product pages).
- **Advertised Product Report** — Performance by individual product.
- **Campaign Report** — High-level campaign performance.
- **Budget Report** — Budget utilization and missed opportunities.

---

## Advertising Measurement Tools

| Tool | Purpose |
|------|---------|
| **Campaign Reporting** | Standard performance tracking within Campaign Manager. |
| **Amazon Attribution** | Measures impact of non-Amazon marketing on Amazon sales. |
| **Amazon Brand Lift** | Measures brand awareness, consideration, and purchase intent changes. |
| **Amazon Marketing Stream** | Real-time hourly performance data via API. |
| **Rapid Retail Analytics** | Retail performance insights. |
| **Omnichannel Metrics** | Multi-channel measurement across online and offline. |
| **Amazon Marketing Cloud** | Advanced data analytics platform for custom audience creation and cross-channel insights. |

---

## Best Practices

### For New Advertisers
1. Start with **Sponsored Products automatic campaigns** to discover keywords.
2. Run for 2-4 weeks to gather data.
3. Review Search Term Report and move winning keywords to manual campaigns.
4. Add poor-performing terms as negative keywords.
5. Gradually add Sponsored Brands and Display as you learn.

### Optimization Cadence
- **Daily:** Check budget status, pause any runaway spending.
- **Weekly:** Review search terms, adjust bids, add negatives.
- **Bi-weekly:** Analyze ACoS/ROAS trends, adjust budgets.
- **Monthly:** Review campaign structure, test new campaigns, analyze new-to-brand metrics.

### Common Mistakes to Avoid
- Setting bids too low (ads will not get impressions).
- Not using negative keywords (wasted spend on irrelevant clicks).
- Running only automatic campaigns (less control over targeting).
- Not checking "budget capped" status (missing sales opportunities).
- Optimizing too frequently without enough data (need 1-2 weeks of data for meaningful changes).
- Ignoring organic ranking impact (advertising drives organic rank improvements).

---

## Global Availability

Amazon Advertising is available in **20+ countries** including: US, Canada, UK, Germany, France, Italy, Spain, Netherlands, Sweden, Poland, Belgium, Australia, Japan, India, Brazil, Mexico, UAE, Saudi Arabia, Egypt, Singapore, and Turkey.

---

## Getting Started

### Requirements
- **Professional selling account** (not Individual plan — $39.99/month).
- **Brand Registry enrollment** (required for Sponsored Brands, Sponsored Display, and Brand Stores).
- Products must have the Buy Box to be eligible for Sponsored Products ads.
- Products must be in "New" condition.

### Steps
1. Log into Seller Central.
2. Navigate to the Advertising tab or visit advertising.amazon.com.
3. Create your first Sponsored Products campaign.
4. Select products, set targeting, choose bids and budget.
5. Launch and monitor performance.

### Support Resources
- **Advertiser Accelerator Program** — Amazon-guided optimization support for new advertisers.
- **Amazon Ads Partner Directory** — Vetted agencies for strategy, creative, and campaign management.
- **Amazon Ads Learning Console** — Free courses and certifications.

---

## Sources

- https://sell.amazon.com/advertising
- https://advertising.amazon.com/
- https://advertising.amazon.com/products/sponsored-products
- https://advertising.amazon.com/products/sponsored-brands
- https://advertising.amazon.com/solutions/products/sponsored-display

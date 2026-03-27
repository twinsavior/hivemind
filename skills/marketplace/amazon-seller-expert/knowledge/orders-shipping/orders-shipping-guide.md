# Amazon Orders & Shipping (FBM) — Comprehensive Guide

## Overview

Fulfilled by Merchant (FBM) is Amazon's fulfillment model where sellers store, pack, and ship orders from their own facilities. This guide covers the complete workflow from order receipt to delivery, including shipping programs, tools, and performance requirements.

---

## FBM Overview

### What Is FBM?

FBM (Fulfilled by Merchant) allows sellers to manage inventory and fulfill customer orders independently from their own warehouses or storage locations. Amazon provides the marketplace and customer base; the seller handles everything else.

### Key Advantages of FBM

- **Lower costs** — No FBA storage or fulfillment fees.
- **More control** — Full control over packaging, branding, and shipping.
- **Flexibility** — Sell specialty items (bulky goods, temperature-sensitive products, slow-moving inventory).
- **Multi-channel** — Use the same inventory for Amazon, your own website, and other channels.
- **Hybrid strategy** — Can be combined with FBA (use FBA for fast-moving items, FBM for others).

### When to Choose FBM Over FBA

- Products with low turnover (avoids long-term FBA storage fees).
- Oversized or heavy items (FBA fees can be very high).
- Products requiring special handling (fragile, temperature-sensitive).
- High-margin items where you want branding control.
- When you already have fulfillment infrastructure in place.

---

## Order Management Workflow

### Step-by-Step Process

1. **Order received** — Amazon notifies you via Seller Central and email when an order is placed.
2. **Confirm shipment** — You must confirm shipment within your stated handling time. Use Manage Orders in Seller Central.
3. **Purchase shipping label** — Use Buy Shipping in Seller Central for discounted rates, or use your own carrier account.
4. **Pack and ship** — Package the item securely and attach the shipping label.
5. **Upload tracking** — Provide valid tracking information to Amazon (automatic if using Buy Shipping).
6. **Customer receives order** — Amazon tracks delivery and notifies the customer.

### Handling Time

- **Definition:** The number of business days between when an order is placed and when you ship it.
- **Standard:** 1-2 business days is typical.
- **Configuration:** Set in your Shipping Settings in Seller Central.
- **Impact:** Longer handling times reduce your chances of winning the Buy Box and qualifying for Premium Shipping.

### Shipping Confirmation Requirements

- **Valid tracking number** is required on every order.
- Confirm shipment in Seller Central with carrier name and tracking number.
- Late shipment confirmations negatively impact your Late Shipment Rate metric.
- Use Buy Shipping for automatic tracking upload and carrier protection.

### Order Cancellation

- Process cancellation requests within **24 hours**.
- High cancellation rates hurt your account health (Pre-Fulfillment Cancel Rate metric).
- If you cannot fulfill an order, cancel it promptly rather than shipping late.

---

## Shipping Programs & Tools

### Buy Shipping

Amazon's integrated shipping label purchase tool within Seller Central.

**Key benefits:**
- Carrier rates **over 31% lower** on average compared to retail ground rates for UPS, FedEx, and USPS.
- Automatic tracking upload to Amazon.
- **6x more Amazon-paid refunds** for A-to-Z claims when using Buy Shipping (Amazon takes responsibility for carrier issues).
- Protects your account health metrics.

**How to use:**
1. Go to Manage Orders in Seller Central.
2. Click "Buy Shipping" on the order.
3. Select carrier and service level.
4. Purchase and print the label.
5. Tracking is automatically uploaded.

### Amazon Shipping

A dedicated ground shipping service from Amazon.

**Features:**
- **2-5 day delivery** for parcels.
- Pickup and delivery **7 days a week**, including weekends.
- Weight capacity: **1-50 lbs** (packages up to 59 x 33 x 33 inches).
- Coverage: **Contiguous United States** domestic shipments only.
- Transparent pricing — no hidden residential delivery or weekend surcharges.
- Real-time tracking from warehouse to customer door.
- Claims typically resolved within **24 hours**.

**Access points:**
- Seller Central dashboard (through Buy Shipping).
- Amazon Shipping portal (ship.amazon.com).
- Third-party integrations (Veeqo, API solutions).
- Mobile app for scheduling and tracking.

**Custom rate negotiations** available for high-volume shippers.

### Shipping Settings Automation

Automatically calculates delivery windows based on seller location, customer location, and historical delivery data.

**Key benefit:** Sellers using Shipping Settings Automation achieved **10% more units sold** on average.

**How it works:**
- You configure your ship-from locations and shipping methods.
- Amazon automatically calculates accurate delivery dates for each customer.
- Eliminates the need for manual transit time estimates.

### Shipping Templates

Configure shipping settings at scale:
- Set shipping rates (free shipping, flat rate, or calculated rates).
- Define transit times by region.
- Set handling times.
- Assign templates to groups of products.
- Supports up to **10 ship-from locations** per template.

---

## Seller Fulfilled Prime (SFP)

### What It Is

Seller Fulfilled Prime lets you display the **Prime badge** on products you fulfill yourself, without using Amazon's fulfillment centers.

### Key Benefits

- **Prime badge** — increases likelihood of becoming the Featured Offer (Buy Box).
- **Customer service** — Amazon handles all post-order customer service for Prime items (returns, refunds, adjustments). Sellers manage pre-order inquiries.
- **Fulfillment flexibility** — Choose your own products, storage facilities, carriers, and packaging.

### Enrollment Process

**Step 1: Prequalification**
- Professional selling account required.
- Domestic US address required.
- Must meet prequalification performance metrics.
- Check eligibility via the SFP trial registration page in Seller Central.

**Step 2: 30-Day Trial**
- Mandatory trial period after prequalification.
- Must meet all performance requirements during the 30-day trial.
- Successful completion activates Prime branding on your listings.

**Step 3: Ongoing Maintenance**
- Must continuously satisfy SFP program policy and performance requirements.
- Performance reviewed **weekly**.

### Performance Requirements

| Metric | Requirement |
|--------|-------------|
| **Late shipment rate** | Must be within acceptable limits |
| **Valid tracking rate** | Must maintain high percentage |
| **Order cancellation rate** | Must be within acceptable limits |
| **Delivery speed** | Same-day, one-day, and two-day delivery depending on product size tier |

**Size tiers affecting delivery speed:**
- Standard-size products.
- Oversize products.
- Extra large products.

### Order Volume Control

SFP sellers can **set daily limits** for how many same-day, one-day, and two-day delivery orders customers can place. This prevents being overwhelmed during high-demand periods.

### Storage Requirements

You are **not required to use warehouses** for SFP orders. Home storage or third-party solutions are acceptable, provided you meet delivery commitments.

### Consequences of Non-Compliance

Persistent failure to meet requirements may lead to:
- Prime offers being disabled.
- Disenrollment from the program.
- Option to requalify and restart later.

---

## Local Selling

### What It Is

Amazon Local Selling enables businesses to reach customers within a defined geographic area on Amazon's marketplace.

### How It Works

1. **Submit application** defining your local service area (down to zip code level).
2. **Create product listings** and inventory for your location.
3. **Begin fulfilling orders** for local customers.
4. Customers outside your delivery zone will not see your offers.

### Delivery Options

| Option | Description |
|--------|-------------|
| **Local Delivery** | Use integrated Amazon shipping partners for 1-2 day delivery |
| **Local Self-Delivery** | Use your own delivery network in your service area |
| **Delivery and Services** | Combine product delivery with services like assembly (currently limited to furniture sellers) |

### Eligibility and Costs

- No additional selling fees beyond standard category referral and Professional plan fees.
- For in-home services: sellers must hold appropriate trade licenses, provide technician headshots, and complete Amazon background checks.

### Benefits

- Define delivery areas precisely by zip code.
- Reduce reliance on third-party carriers.
- Offer faster local delivery.
- Access Amazon's customer base in your area.
- Dedicated seller support team.

---

## Multi-Location Inventory

### What It Is

A **free service** for FBM sellers that syncs inventory levels across multiple US warehouse locations. Amazon calculates delivery promises based on the closest inventory location to each customer, improving delivery dates and increasing sales.

### Key Benefits

1. **Accurate delivery calculations** — Uses closest available inventory location and your shipping methods.
2. **Simplified shipping administration** — One shipping template serves all locations.
3. **Enhanced inventory visibility** — Shows the most precise available inventory to customers.
4. **Automated synchronization** — Automatically syncs inventory count per location.

### Eligibility

- FBM sellers only (not FBA).
- Multiple US locations required.
- Must enable Shipping Settings Automation.

### Setup Process

**Step 1: Location Setup**
- Create and manage locations (Supply Sources) through API or Seller Central.

**Step 2: Inventory Management**
- Update inventory via: SP-API, Feeds API, feed file uploads, or Manage All Inventory feature.
- **Critical first step:** Zero out your "Default" fulfillment channel inventory for SKUs using location-level inventory.

**Step 3: Shipping Automation**
- Enable Shipping Settings Automation in Seller Central.
- Select ship-from locations matching your inventory locations.
- Choose Prime or non-Prime templates.
- Configure carrier and shipping service preferences.

### Technical Details

- **Location limit:** Shipping templates support maximum **10 locations**.
- Not all ASINs need to participate — you can mix multi-location and standard inventory SKUs on the same template.
- Compatible with Seller Fulfilled Prime.
- Supported integrators: SellerCloud, Linnworks, eTail Solutions, SureDone, FellowShip.

### Important Note

If Shipping Settings Automation is accidentally disabled, orders continue processing but delivery promises revert to manual calculations, eliminating multi-location benefits.

---

## Veeqo Integration

### What Is Veeqo?

Veeqo is Amazon's **free shipping software** for multi-channel sellers. It provides shipping, inventory management, and analytics tools.

### Key Features

**Shipping & Cost Reduction:**
- Pre-negotiated rates from UPS, FedEx, USPS, and DHL.
- Connect your own carrier accounts.
- **Up to 5% cashback** through Veeqo credits on eligible shipments.
- **20% fewer late deliveries** on average for Amazon orders.
- Bulk shipping (up to 100 orders simultaneously).
- Intelligent carrier selection based on weight, value, and destination.

**Account Health Protection:**
- Safeguards On-Time Delivery Rate (OTDR), Order Defect Rate (ODR), and Valid Tracking Rate (VTR).
- A-to-Z Guarantee delivery claims protection.

**Inventory Management:**
- Real-time inventory syncing across all channels.
- Low-stock alerts prevent overselling.
- Automated inventory control.

**Analytics & Reporting:**
- Near real-time sales, revenue, and fee data.
- Profit analyzer tool for product-level profitability.
- Cost of goods sold (COGS) tracking.
- Ad spend monitoring.

**Warehouse Operations:**
- Digital picking with mobile device support.
- Real-time inventory records.
- Optimized picking lists and routes.

### Multi-Channel Support

Veeqo integrates with:
- Amazon (including Multi-Channel Fulfillment).
- eBay.
- Etsy.
- Shopify.
- Walmart.
- Multiple shipping carriers.

### Pricing

- **Core features are free** for all sellers.
- Paid premium plans available for: Inventory Sync, Digital Picking, Veeqo Listings, ERP Integrations.
- Priority support subscription with dedicated account manager available.

---

## FBM Performance Metrics

### Critical Metrics to Monitor

| Metric | Target | Description |
|--------|--------|-------------|
| **Order Defect Rate (ODR)** | Below 1% | A-to-Z claims, negative feedback, and chargebacks as % of orders |
| **Late Shipment Rate (LSR)** | Below 4% | Orders confirmed shipped after expected ship date |
| **Pre-Fulfillment Cancel Rate** | Below 2.5% | Orders cancelled by seller before shipment |
| **Valid Tracking Rate (VTR)** | Above 95% | Orders with valid tracking information |
| **On-Time Delivery Rate (OTDR)** | Above 97% | Orders delivered by the promised date |

### Consequences of Poor Performance

- Warning notifications from Amazon.
- Loss of Buy Box eligibility.
- Account suspension or deactivation for persistent violations.
- Loss of Seller Fulfilled Prime eligibility.

### Monitoring Tools

- **Account Health Dashboard** — Overview of all performance metrics.
- **Fulfillment Insights Dashboard** — Detailed shipping and delivery analytics.
- **Customer Metrics** — Feedback and satisfaction tracking.

---

## Best Practices for FBM Sellers

1. **Use Buy Shipping** for every order — saves money and protects your account.
2. **Set realistic handling times** — better to under-promise and over-deliver.
3. **Enable Shipping Settings Automation** — improves delivery date accuracy and increases sales.
4. **Confirm shipment immediately** after handing off to the carrier.
5. **Always provide valid tracking** on every order.
6. **Respond to buyer messages within 24 hours** — Amazon monitors response times.
7. **Process cancellation requests within 24 hours**.
8. **Monitor Account Health Dashboard daily** during early selling phases.
9. **Consider Veeqo** for multi-channel inventory sync and shipping automation.
10. **Start with standard shipping** and work toward Premium Shipping and SFP as you build performance history.

---

## Sources

- https://sellercentral.amazon.com/help/hub/reference/external/G28141
- https://sell.amazon.com/programs/fulfilled-by-merchant
- https://sell.amazon.com/programs/seller-fulfilled-prime
- https://sell.amazon.com/programs/shipping
- https://sell.amazon.com/programs/local-selling
- https://sell.amazon.com/programs/multi-location-inventory
- https://sell.amazon.com/tools/veeqo

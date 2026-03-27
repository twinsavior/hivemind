# WFS Operations & Shipping: Complete Guide

## Overview

This guide covers the operational aspects of Walmart Fulfillment Services (WFS), including how to ship inventory to WFS fulfillment centers, the Preferred Carrier program, prep services, inventory management, and returns handling.

---

## Shipping to WFS: Domestic Shipping Plans

### What is a Shipping Plan?
A shipping plan tells Walmart what items you are sending, how you are sending them, and when they can expect them to arrive. Every inbound shipment to WFS requires a shipping plan.

### Creating a Shipping Plan
1. Navigate to **Shipping Plans** in Seller Center.
2. Select items to include in the shipment.
3. Specify quantities for each item.
4. Choose your shipping method (Preferred Carrier or own carrier).
5. Provide ship-from address and shipment details.
6. Walmart assigns the destination fulfillment center(s).
7. Print labels and prepare inventory for shipment.

### Key Considerations
- Walmart determines which fulfillment center(s) receive your inventory.
- Inventory may be split across multiple fulfillment centers for optimal distribution.
- Each shipping plan has a unique shipment ID for tracking.

---

## Walmart Preferred Carrier (WPC) Program

### Overview
The WPC Program provides access to trusted carrier partners with discounted, Walmart-negotiated rates for shipping inventory to WFS facilities. The program covers three shipping types:

- **Parcel**: Individual packages via FedEx or UPS
- **Less Than Truckload (LTL)**: Palletized shipments that do not fill a full truck
- **Full Truckload (FTL)**: Full truck shipments

### Key Benefits
- **Cost Savings**: Access to Walmart-negotiated rates for high-volume shipments.
- **Simplified Management**: No carrier bidding or coordination required.
- **Convenient Billing**: Estimated shipping prices display during preparation; costs deducted from WFS sales.

### How It Works
1. **Selection & Estimation**: Choose the preferred carrier option during shipping plan creation and receive pricing estimates based on origin, destination, and shipment specifications.
2. **Carrier Assignment**: Walmart automatically assigns the lowest-cost available carrier.
3. **Fulfillment**:
   - Parcel: Choose between FedEx and UPS for drop-off or pickup.
   - LTL/FTL: Walmart assigns a carrier based on the lowest cost available (no seller selection).

### Shipment Specifications

**Parcel**:
- Up to 999 master cases
- Maximum 150 lbs per case
- Case dimensions: up to 108" length and 165" (length + girth)

**LTL (Less Than Truckload)**:
- 12 unstacked or 24 stacked pallets maximum
- 22,000 lbs total weight limit
- 1,200 cubic feet capacity

**FTL (Full Truckload)**:
- 26 unstacked or 52 stacked pallets maximum
- 45,000 lbs total weight capacity

### Pallet Standards
- All shipments require **48" x 40", 4-way-access, solid wood pallets**.
- Non-stackable pallets must remain below **72" height**.
- Stackable pallets must not exceed **50" height**.

### Pricing & Modification Windows
- **Parcel**: 24 hours to void charges or edit shipments after quote acceptance.
- **LTL/FTL**: 1 hour to void charges or edit shipments after quote acceptance.

### Geographic Limitations
- Preferred carriers only accept shipments from within the **48 contiguous United States**.
- International sellers and those shipping from Hawaii or Alaska must use alternative carriers.

### Prohibited Items
- Dangerous goods and hazmat items are prohibited on preferred carrier shipments.
- Sellers shipping hazardous materials must use their own carriers.

### Setup & Booking
Sellers provide:
- Ship-from address
- Number of cases/pallets
- Weight and dimensions per case/pallet
- LTL/FTL pickup contact details

### Pickup Scheduling
- For parcel: FedEx or UPS drop-off/pickup available.
- For LTL/FTL: Seller requests pickup date; Walmart confirms via email.
- Labels and bill of lading can be sent to manufacturers/suppliers for direct pickup.

### Tracking
- View tracking updates from the carrier in Seller Center from the Shipping Plans page once pickup occurs.

---

## Using Your Own Carrier

- If you prefer not to use the Preferred Carrier program, you can ship inventory using your own carrier.
- You are responsible for carrier coordination, booking, and costs.
- Must still follow all WFS labeling, packing, and delivery appointment requirements.
- Required for hazmat items (which are prohibited on Preferred Carrier shipments).
- Required for shipments originating outside the 48 contiguous United States.

---

## Prep Services

### Overview
WFS Prep Services allows sellers to outsource inventory preparation when they lack the time, infrastructure, or labor to prepare items correctly and consistently.

### Available Services

**Poly Bagging**:
- Packages each sellable unit in a clear, protective bag for storage and fulfillment.
- **Planned fee**: $0.60 per unit
- **Unplanned fee**: $0.80 per unit
- Maximum dimensions: 18" x 24"
- Ideal for: apparel, plush toys, small items, liquids, powders, and pellets.

**Item Labeling**:
- Places readable, scannable labels on every sellable unit.
- **Planned fee**: $0.45 per unit
- **Unplanned fee**: $0.65 per unit
- Ensures proper labeling, receiving, and storage.

### Unplanned Prep
- If items arrive unprepared or incorrectly prepared, WFS charges an additional **$0.20 per unit** beyond standard fees.
- Processing timelines may extend up to **10 business days** for unplanned prep work.

### Requirements
- Items must comply with WFS Routing and Packaging Guide standards.
- WFS will not label over existing scannable barcodes -- sellers must remove or cover them beforehand.
- Valuables (jewelry, watches, sunglasses) require tamper-evident sealed packaging.

### How to Enroll
- **Via Seller Center**: Navigate to Shipping Plans, create a plan, and select prep options when establishing packing templates.
- **Via API**: Use the Create Inbound Shipment API through the Developer Portal.

### Reporting
- Prep service fees appear in Settlement Reports and Marketplace/WFS Reports.
- Transaction type: "PrepServiceFee" noting whether work was "Bag" or "Label" related.

---

## Inventory Transfer Service

- Simplifies distributing inventory across the WFS network.
- Walmart splits the inventory and distributes it nationwide.
- Some inventory is typically available to sell within **4 business days**.
- Reduces shipping times by positioning inventory closer to customers.
- Particularly useful for sellers who ship to a single fulfillment center.

---

## Labels and Packing Requirements

### Item Labels
- All items must have a barcode label on the outermost part of the sellable unit.
- Labels must be readable and scannable with **GTIN (14 digits)** or **UPC (12 digits)**.
- Price tags, item labels, and retailer-specific labels should NOT be on item packaging.
- Expiration or "best by" dates must be displayed in **MM-DD-YYYY** format.

### Receiving Labels
- Each master case and pallet must have a receiving label with the **shipment ID**.
- Receiving labels allow fulfillment centers to properly identify and process incoming shipments.
- If using Walmart Preferred Carrier, download the carrier label for pickup scanning.

### Packing Requirements
- All items must be protected in a sealed or closed container, ready for sale.
- Packaging must reasonably protect items from damage during shipping.
- Packaging must protect carrier, warehouse associates, and customers from safety hazards.
- Items must be contained throughout transit.

### Containers and Dunnage
- Use appropriate containers (boxes, poly bags, etc.) for item protection.
- Use dunnage (packing materials) to prevent movement and damage within containers.
- Follow WFS Routing and Packaging Guide for specific container requirements.

---

## Master Case and Pallet Requirements

### Master Case Requirements
- Cases must be properly sealed and labeled.
- Each case must have a receiving label with the shipment ID.
- Cases should contain items listed in the shipping plan.
- Maximum weight: 150 lbs per case (for Preferred Carrier parcel).

### Pallet Requirements
- Use **40" x 48", four-way access, solid wood pallets**.
- Each pallet's weight must be under **2,100 lbs**.
- Non-stackable pallets: maximum **72" height**.
- Stackable pallets: maximum **50" height**.
- Pallets must be stable and shrink-wrapped for transport.

---

## Delivery Appointments

- Delivery appointments must be scheduled with fulfillment centers before arrival.
- Schedule appointments through Seller Center during the shipping plan process.
- LTL and FTL shipments require confirmed appointment times.
- Arriving without an appointment may result in delays or refusal.

---

## Receiving Process

- Receiving typically takes **2 business days** after delivery.
- May extend to **10 business days** if items require prep work.
- Items are inspected, counted, and placed in storage upon receiving.
- Discrepancies between shipping plan and received items are tracked.
- Sellers can monitor receiving status in Seller Center.

### Shipment Health
- Monitor shipment health through the Shipping Plans dashboard.
- Track receiving progress, discrepancies, and issues.
- Address any receiving discrepancies through dispute claims if needed.

---

## Inventory Management

### Inventory Tracking
- Track WFS inventory levels in real-time through Seller Center.
- Monitor stock levels, sales velocity, and reorder needs.
- Inventory data syncs across all sales channels if using Multichannel Solutions.

### Multi-Box Inventory
- Items shipped in multiple boxes are tracked as a single unit.
- Each box in the set is stored and shipped together.
- Multi-box inventory requires specific setup in Seller Center.

### Inventory Health Page
- The Inventory Health page provides insights into inventory performance.
- Monitor aging inventory to avoid long-term storage fees (charges begin after 1 year).
- Track sales velocity and identify items that may need replenishment or removal.
- Identify slow-moving inventory that may be candidates for pricing adjustments or removal.

---

## Customer Orders via WFS

- When a customer places an order for a WFS item, Walmart handles the entire fulfillment process.
- Orders are automatically picked, packed, and shipped from the nearest fulfillment center.
- Customers receive tracking information and delivery updates.
- Walmart provides all customer service for WFS orders.
- Sellers can monitor order status through Seller Center.

---

## Inventory Movements (MTR - Movement Transaction Record)

- Track all inventory movements within the WFS network.
- Movements include: receiving, storage, picking, shipping, returns, transfers, and removals.
- MTR reports provide detailed transaction-level data.
- Use movement data for reconciliation and inventory auditing.

---

## Removing Items from WFS

- Sellers can request removal of inventory from WFS fulfillment centers.
- Removal options: return to seller or disposal.
- Removal fees apply (see WFS Basics guide for fee schedule).
- Create removal orders through Seller Center.
- Processing time varies based on volume and fulfillment center workload.

### Disposal Fees
- Up to 2 lb: $0.35 disposal + $0.40/lb shipping
- 3-500 lb: $0.35 + $0.20 for each lb over 2 lb disposal + $0.40/lb shipping
- Hazmat surcharge: Additional $0.50 on base disposal fee

---

## Aged Inventory

- Inventory stored for more than **365 days** incurs long-term storage fees of **$2.25 per cubic foot per month** (effective June 9, 2025).
- Monitor aging inventory through the Inventory Health page.
- Consider removal, price reductions, or promotions for slow-moving inventory.
- Walmart provides aging inventory reports to help sellers manage storage costs.

---

## WFS Returns

### Return Processing
- Walmart manages all customer returns for WFS orders.
- Customers follow standard Marketplace return policies.
- Return shipping labels direct to Walmart fulfillment centers for inspection.
- Fulfillment center staff handle item inspection and condition assessment.

### Return Rules
- Sellers can set **"Keep It"** or **"Partial Keep It"** return rules (honored when possible).
- "Keep It" allows customers to keep low-value items rather than returning them, reducing reverse logistics costs.
- Integration with Free & Easy Returns omnichannel program.

### Return Processing Fees
- Standard return fees apply based on item weight (see WFS Basics guide for fee schedule).
- **Walmart At-Fault Returns**: Walmart waives return processing fees for: lost in transit, lost after delivery, unable to deliver, item damaged, shipping box damaged, arrived late, or wrong item received.

### Customer Return Reimbursement
- Dispute claim procedures are available for return-related issues.
- Sellers can file disputes within specified timeframes.

---

## Multichannel Solutions (MCS)

### Overview
- Multichannel Solutions allows sellers to use WFS to fulfill orders from other ecommerce sales channels (not just Walmart.com).
- Centralize inventory across multiple platforms using Walmart's fulfillment infrastructure.

### Key Features
- **Item Setup**: Configure items for multiple sales channels.
- **Sales Channel Addition**: Add non-Walmart sales channels to your WFS account.
- **Customer Order Management**: Manage orders from all channels through a unified system.
- **API Integration**: Use APIs for automated multichannel order processing.
- **Solution Provider Automation**: Third-party tools can integrate with MCS.

### Fulfillment Process
- Orders from external channels are submitted to WFS via API or solution provider.
- WFS picks, packs, and ships the order using the same infrastructure.
- Tracking information is provided back to the originating sales channel.

### Returns
- Customer return handling for MCS orders follows separate procedures.
- Returns may be handled differently than standard Walmart.com returns.

---

## WFS Reports

### Available Reports

| Report | Description |
|--------|-------------|
| Customer Returns | Analysis of returned items and reasons |
| GMV Penetration | Tracking WFS share of total Marketplace sales |
| Inbound Receipt | Documentation of received inventory |
| Inbound Transportation | Metrics on inbound shipping performance |
| Inventory Health | Indicators of inventory performance and aging |
| Inventory Reconciliation | Procedures for resolving inventory discrepancies |
| Item Conversion | Analytics on converting items to WFS |
| Marketplace and WFS Payment | Payment summaries for both channels |
| Order Reports | WFS order fulfillment data |
| Settlement Documentation | Detailed fee and payment breakdowns |
| Storage Fee Reports | Storage charges by item and time period |

### Accessing Reports
- Navigate to **Reports** or **Analytics** in Seller Center.
- Download reports in Excel or CSV format.
- Use reports to identify optimization opportunities and manage costs.

---

## WFS Troubleshooting

### Common Issues and Solutions

**Item Template Errors**:
- Review error messages in the Activity Feed.
- Ensure all required fields are completed accurately.
- Verify dimensions, weights, and product identifiers.

**Shipping Plan Issues**:
- Confirm item quantities match available inventory.
- Verify ship-from address is within the contiguous United States (for Preferred Carrier).
- Check that items are not on the prohibited products list.

**Receiving Discrepancies**:
- Compare shipping plan quantities with received quantities in Seller Center.
- File dispute claims for significant discrepancies.
- Provide documentation (shipping labels, carrier receipts) to support claims.

**Inventory Rejections**:
- Items may be rejected for improper packaging, labeling, or condition issues.
- Review rejection reasons in Seller Center.
- Correct issues and reship items with a new shipping plan.

**Order Fulfillment Issues**:
- Monitor order status for any fulfillment delays.
- Contact WFS support for stuck or problematic orders.

**Dispute Claims**:
- File disputes for receiving discrepancies, inventory damage, or customer return issues.
- Provide supporting documentation.
- Follow up through Seller Center case management.

---

## Sources

- https://marketplace.walmart.com/walmart-fulfillment-services/
- https://marketplacelearn.walmart.com/guides
- https://marketplacelearn.walmart.com/guides/Shipping%20&%20fulfillment/Walmart%20Fulfillment%20Services%20(WFS)/walmart-fulfillment-services-wfs-overview
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/Walmart-Preferred-Carrier-(WPC)-program
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/WFS-prep-services
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/WFS-inbound-orders-Prepare-and-pack-shipments
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/WFS-inbound-orders:-Send-inventory
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/WPC-prepare-pickup
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/wfs-inbound-orders-schedule-delivery-appointments
- https://marketplacelearn.walmart.com/guides/Shipping%20&%20fulfillment/Walmart%20Fulfillment%20Services%20(WFS)/WFS-routing-guide-overview
- https://marketplacelearn.walmart.com/guides/WFS-inbound-orders-Labels
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/WFS-inbound-orders:-Select-containers-and-dunnage
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/Shipping%20to%20WFS/WFS-inbound-orders-Select-&-pack-pallets
- https://marketplacelearn.walmart.com/guides/Walmart%20Fulfillment%20Services%20(WFS)/WFS%20basics/WFS-fees

# Order Management on Walmart Marketplace: Complete Guide

## Overview

Order management is a critical operational function for Walmart Marketplace sellers. From the moment a customer places an order on Walmart.com, sellers must acknowledge, fulfill, and track orders within strict timelines. Performance metrics tied to order management directly affect search visibility, Buy Box eligibility, and account standing.

---

## Order Processing Workflow

The order lifecycle follows a structured progression through Walmart Seller Center:

```
Created --> Acknowledged --> Shipped --> Delivered
              |
              +--> Cancelled (at any stage before delivery)
```

1. **Customer places order** on Walmart.com.
2. **Order Created**: A new order appears in Seller Center with "Created" status.
3. **Seller Acknowledges**: Seller confirms ability to fulfill the order.
4. **Seller Ships**: Seller packs and ships the order, providing tracking information.
5. **Order Delivered**: Package reaches customer destination.

---

## Order Statuses

| Status | Description |
|--------|-------------|
| **Created** | Customer has placed the order. Ready to be acknowledged. |
| **Acknowledged** | Seller confirmed fulfillment commitment. Order is waiting to be shipped (SentForFulfillment status). |
| **Shipped** | Order marked as shipped with tracking information provided. |
| **Delivered** | Package reached customer destination. |
| **Cancelled** | Either the seller or Walmart terminated the transaction. |

**Important**: Once an order has been updated to Shipped or Cancelled, it is considered closed and cannot be updated or edited.

---

## Managing Orders in Seller Center

### Order Dashboard
- Access orders through **Orders > Order Management** in Seller Center.
- View all open, in-progress, and completed orders.
- Filter orders by status, date range, and other criteria.
- Search for specific orders by order number or customer details.

### Order Details
- Each order shows: items, quantities, prices, shipping address, shipping method, expected ship date, and expected delivery date.
- Customer information is provided for fulfillment purposes only.

---

## Order Acknowledgment

### Requirements
- Acknowledgment is **mandatory** and **time-sensitive**.
- Sellers should acknowledge orders within **4 hours** during business hours.
- This commitment binds sellers to fulfill within the required timeframes.

### How to Acknowledge
1. Navigate to **Orders > Order Management** in Seller Center.
2. Select the checkboxes for orders to acknowledge.
3. Click **"Acknowledge Orders"**.

### Impact of Not Acknowledging
- Failing to acknowledge impacts the **On-Time Shipment Rate (OTSR)**.
- Orders not acknowledged in a timely manner may be auto-cancelled.
- Consistent failure to acknowledge orders can affect account standing.

---

## Shipping Orders

### Process
1. **Pick and pack** the order from your fulfillment center.
2. **Print materials**: Generate packing slips and shipping labels from Seller Center or your own system.
3. **Ship the order**: Tender the package to an approved carrier.
4. **Mark as shipped**: In Seller Center, click "Mark as Shipped" and enter:
   - Carrier name (must be a Walmart-approved carrier)
   - Tracking number
   - Ship date
   - Shipping method (standard, expedited, etc.)

### Shipping Deadlines
- Orders must ship by the **Expected Ship Date**, typically within **1-2 business days** after order creation.
- Auto-cancellation occurs if the order is not marked as shipped and tracking information has not been uploaded by the Expected Ship Date plus **four calendar days**.

### Tracking Requirements
- Valid tracking information must be provided for **99%+ of orders**.
- Use trackable shipping services with proper carrier documentation.
- Tracking numbers are editable for up to **four hours** after updating the order to Shipped status.
- Provide both carrier name and tracking number.
- Only communicate tracking to Walmart once the package has been physically tendered to the carrier.

---

## Order Cancellations

### Seller-Initiated Cancellations
- Sellers can cancel orders by selecting a preset cancellation reason in Seller Center.
- Common reasons: out of stock, pricing error, customer request, unable to fulfill.

### Impact on Performance
- High cancellation rates **negatively affect** customer experience and seller metrics.
- **Order Cancellation Rate (OCR) target**: less than **2%**.
- Exceeding 2% cancellation rate can result in:
  - Lower search visibility
  - Buy Box removal
  - Account suspension

### Prevention
- Maintain synchronized, accurate inventory levels across all channels.
- Set inventory buffers to reduce overselling risk.
- Monitor inventory regularly to prevent stockout situations.

### Auto-Cancellation by Walmart
- If an order is not shipped within the Expected Ship Date plus four calendar days, Walmart may automatically cancel the order and refund the customer.
- Orders not delivered within five days past the Expected Delivery Date with no carrier movement in three days may also be auto-cancelled.

---

## Partial Shipments

- Sellers can ship orders in multiple shipments if not all items are available at once.
- Each partial shipment must include its own tracking number.
- Mark each shipment separately in Seller Center with the items included.
- Avoid partial shipments when possible, as they can increase shipping costs and affect customer satisfaction.

---

## Tracking Updates

### Valid Tracking Rate (VTR)
- Target: **greater than 99%**.
- Tracking must be uploaded on time with accurate carrier information.
- Use trackable services only -- stamps and prepaid USPS envelopes without tracking are prohibited.

### Tracking Compliance
- Only use **Walmart-approved carriers** (see the Seller Fulfillment guide for the full list).
- Non-approved carriers may result in suppression, suspension, or termination because tracking cannot be validated.
- Double-check carrier details before submitting tracking information.

---

## Order Reports

### Available Reports
- **Open Orders Report**: View all orders awaiting fulfillment.
- **Shipped Orders Report**: Track orders that have been shipped.
- **Cancelled Orders Report**: Review cancelled orders and reasons.
- **Returns Report**: Monitor customer returns and refund requests.
- **Performance Dashboard**: Real-time metrics on order performance.

### Bulk Order Processing
- High-volume sellers can manage orders via **Excel or API integration**.
- Download open orders in bulk.
- Update fulfillment information in batches.
- Re-upload files to mark multiple orders as shipped simultaneously.

### API Integration
- Walmart's Orders API allows programmatic order management.
- Endpoints for: retrieving orders, acknowledging orders, shipping confirmation, cancellations, and refunds.
- Recommended for sellers managing high volumes across multiple platforms.

---

## Returns and Refunds

### Seller-Fulfilled Returns Policy
- Walmart Marketplace has a standard returns policy with specific return windows and exemptions.
- Sellers must accept returns for eligible items within the return window.
- Return policies must allow for quick and easy merchandise returns for a variety of reasons.

### Refund Processing
- **Refund Rate target**: less than **6%**.
- Seller-responsible refunds include: damaged items, incorrect items, items not matching description.
- Process refunds promptly through Seller Center.

### Minimizing Refunds
- Optimize product listings for accuracy (images, descriptions, specifications).
- Use quality packaging to protect items during transit.
- File disputes for failed delivery or return-to-sender cases within **45 days**.

---

## Handling Order Issues

### Fraudulent Orders
- Walmart automatically screens orders for fraud.
- Upon detection, Walmart attempts cancellation before seller receives the order.
- If a fraudulent order is already received, sellers get a "Fraud -- Stop Shipment" email alert.
- For already-shipped fraudulent orders, contact the carrier for stop shipment requests.
- Sellers believing Walmart missed a fraudulent order can request a Walmart Risk Prevention Team review.

### Disputes
- Customers claiming undelivered orders may be eligible for dispute filing within **45 days** of refund issuance.
- Sellers strengthen claims by providing valid tracking numbers and delivery confirmation documentation.
- File disputes through Seller Center case management.

### Pausing Operations
Three mechanisms are available to pause order fulfillment:

1. **Set Inventory to Zero**: Fast, flexible pause preventing new customer orders while maintaining positive customer experience.
2. **Adjust Shipping Setting Days**: Designate specific dates (holidays, absences) where listings remain visible but fulfillment dates auto-adjust.
3. **Request Temporary Deactivation**: For critical situations (natural disasters, major outages), contact Walmart Support through the Help menu.

---

## Performance Metrics Overview

Four critical metrics determine seller success on Walmart Marketplace:

| Metric | Target | Description |
|--------|--------|-------------|
| **On-Time Delivery Rate (OTD)** | > 95% | Orders delivered by the expected delivery date. Ship orders same-day or next business day. |
| **Valid Tracking Rate (VTR)** | > 99% | Orders with valid, trackable shipping information from approved carriers. |
| **Order Cancellation Rate (OCR)** | < 2% | Percentage of orders cancelled by the seller. Maintain updated inventory to prevent overselling. |
| **Refund Rate** | < 6% | Seller-responsible refunds from damaged or misrepresented items. |

### Consequences of Poor Performance
- Lower search visibility on Walmart.com
- Buy Box removal
- Selling limits imposed
- Fund withholding
- Account suspension or termination

### Monitoring Performance
- Access the **Performance Dashboard** in Seller Center.
- Monitor metrics weekly for early detection of issues.
- Use Walmart's alerts and notifications to stay informed of metric changes.

---

## WFS Order Management

- For items fulfilled by WFS, Walmart handles the entire fulfillment process automatically.
- Orders are picked, packed, and shipped from Walmart's fulfillment centers.
- Walmart provides customer service for all WFS orders.
- Sellers monitor WFS order status through Seller Center but do not need to manually fulfill.
- WFS orders benefit from 2-day shipping badges and enhanced search visibility.

---

## Best Practices

### Inventory Management
- Maintain accurate, synchronized inventory across all sales channels.
- Set safety stock buffers to prevent overselling.
- Use Walmart's inventory management tools for real-time tracking.

### Order Fulfillment
- Ship orders as quickly as possible -- exceeding customer expectations improves metrics.
- Use approved carriers with reliable tracking.
- Print packing slips and shipping labels through Seller Center for accuracy.

### Communication
- Proactively communicate delays to Walmart Support.
- Respond to customer inquiries promptly.
- Monitor order-related alerts and notifications in Seller Center.

### Automation
- Leverage Walmart's API for automated order processing.
- Use third-party integration tools for multichannel order management.
- Automate tracking number uploads and status updates.

### Scaling
- Consider WFS for hands-off fulfillment as order volume grows.
- Use bulk order processing tools for high-volume operations.
- Monitor and optimize all four performance metrics consistently.

---

## Sources

- https://marketplacelearn.walmart.com/guides
- https://marketplacelearn.walmart.com/guides/Order%20management/Order%20status/Cancel-an-order-in-Seller-Center
- https://marketplacelearn.walmart.com/guides/Order%20management/Order%20status/Acknowledge-orders-in-Seller-Center
- https://marketplacelearn.walmart.com/guides/Order%20management/Order%20status/Pause-sales-&-order-operations
- https://marketplacelearn.walmart.com/academy/Order%20management/order-management
- https://goaura.com/blog/walmart-order-management-a-complete-guide
- https://developer.walmart.com/doc/us/mp/us-mp-orders/

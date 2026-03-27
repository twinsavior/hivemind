# Amazon Seller Performance Metrics Guide

## Overview

Amazon monitors seller performance through a set of quantitative metrics designed to ensure a high-quality customer experience. These metrics directly impact your Account Health Rating (AHR), Buy Box eligibility, search ranking visibility, and whether your account remains active. All seller-fulfilled orders are measured; FBA orders are handled by Amazon and generally do not count against your shipping metrics.

---

## Order Defect Rate (ODR)

### What It Is
The Order Defect Rate is Amazon's primary measure of customer service quality. It represents the percentage of orders that have received one or more indicators of poor customer experience.

### Target Threshold
- **Must remain below 1%**
- An ODR at or above 1% puts your account at risk

### Measurement Period
- Rolling **60-day** window
- Calculated based on order date, not the date feedback/claims are received

### Components (Three Metrics Combined)

#### 1. Negative Feedback Rate
- Counts orders that receive **1-star or 2-star** seller feedback ratings
- Calculated by dividing orders with negative feedback by total orders
- Feedback is attributed to the order date, not when the buyer leaves it
- Buyers can remove feedback, which will remove it from your ODR calculation
- **Note**: Product reviews (on the product page) are different from seller feedback and do NOT affect ODR

#### 2. A-to-Z Guarantee Claim Rate
- Counts orders where a buyer files an A-to-Z Guarantee claim
- Formula: Orders with A-to-Z claims / Total orders over 60 days
- **Only claims attributed to seller fault impact ODR**
- Claims that are denied by Amazon or withdrawn by the buyer do NOT count
- Common triggers: item not received, item significantly different from description, return issues

#### 3. Credit Card Chargeback Rate
- Counts orders disputed through the buyer's credit card issuer
- Common reasons: non-receipt of item, unprocessed refund, damaged/defective item
- Chargebacks are costly -- you lose the sale amount plus potential chargeback fees

### Calculation Formula
```
ODR = (Orders with at least one defect / Total orders in 60-day window) x 100
```

**Example**: 10 defective orders out of 1,500 total = 0.67% ODR (acceptable)

**Important**: If an order has multiple defect types (e.g., both negative feedback AND an A-to-Z claim), it counts as only ONE defective order.

### Consequences of High ODR
- **Below 1%**: Acceptable performance, full selling privileges
- **At or above 1%**:
  - Reduced or lost Buy Box eligibility
  - Product listing suppression
  - Account suspension warning
  - Potential account deactivation
  - Amazon may offer a **72-hour remedial quiz** before taking action

### How to Monitor
- Seller Central: **Performance > Account Health > Order Defect Rate**
- Download the ODR report for detailed order-level analysis
- Review each component separately to identify problem areas

### How to Improve ODR
1. Ship orders on time with proper packaging
2. Respond to customer messages within 24 hours
3. Provide accurate product descriptions and images
4. Process refunds and returns promptly
5. Use FBA to reduce fulfillment-related defects
6. Proactively communicate about delays
7. Monitor and address A-to-Z claims immediately (respond within 3 calendar days)
8. Sell high-quality products to reduce complaints

---

## Late Shipment Rate (LSR)

### What It Is
The percentage of seller-fulfilled orders where shipping confirmation was provided after the expected ship date.

### Target Threshold
- **Must remain below 4%**

### Measurement Period
- Tracked over **10-day and 30-day** rolling windows

### How It Is Calculated
```
LSR = (Orders confirmed shipped late / Total orders) x 100
```
An order is "late" if you confirm shipment after the expected ship date shown in your order details.

### Consequences
- LSR above 4% disqualifies you from the Buy Box
- Persistent high LSR leads to account health degradation
- Can trigger performance warnings and eventual suspension

### How to Improve LSR
1. Confirm shipment on the same day you ship
2. Set realistic handling times in your shipping settings
3. Use automated shipping confirmation through integrated carriers
4. Maintain adequate inventory to avoid backorder delays
5. Ship before the expected date when possible
6. Consider using FBA for products with frequent late shipments

---

## Pre-Fulfillment Cancel Rate

### What It Is
The percentage of orders cancelled by the seller before shipping confirmation.

### Target Threshold
- **Must remain below 2.5%**

### How It Is Calculated
```
Cancel Rate = (Orders cancelled by seller before ship confirm / Total orders) x 100
```

### What Triggers Cancellations
- Out-of-stock situations
- Pricing errors
- Unable to fulfill for other reasons
- Buyer-requested cancellations also count if processed as seller cancellation

### Consequences
- Rate above 2.5% degrades account health
- Reduces Buy Box eligibility
- Can lead to account warnings or suspension

### How to Improve
1. Keep inventory counts accurate and updated in real time
2. Use inventory management software to prevent overselling
3. If selling on multiple channels, sync inventory across all platforms
4. Do not list items you cannot reliably fulfill
5. Process buyer-requested cancellations correctly (use the buyer cancellation reason code)

---

## Valid Tracking Rate (VTR)

### What It Is
The percentage of seller-fulfilled shipments that include a valid, functional tracking number from a supported carrier.

### Target Threshold
- **Must be 95% or higher**

### How It Is Calculated
```
VTR = (Shipments with valid tracking / Total shipments) x 100
```
A tracking number is "valid" if:
- It is from a supported carrier
- It shows at least one carrier scan event
- It is entered before the delivery confirmation deadline

### Consequences
- VTR below 95% can reduce Buy Box eligibility
- May trigger performance warnings
- Impacts overall account health score

### How to Improve
1. Always use carriers supported by Amazon (UPS, USPS, FedEx, etc.)
2. Enter tracking numbers promptly after shipping
3. Verify tracking numbers are valid before confirming shipment
4. Use integrated shipping solutions that auto-populate tracking
5. Audit your VTR report regularly for problem carriers

---

## On-Time Delivery Rate (OTDR)

### What It Is
The percentage of packages that arrive to the buyer by the estimated delivery date. This metric was introduced on **September 25, 2024**.

### Target Threshold
- **Must be 90% or higher**

### How It Is Calculated
```
OTDR = (Packages delivered on or before estimated delivery date / Total tracked deliveries) x 100
```

### Why It Matters
- Directly measures the buyer experience of receiving orders when expected
- Complements LSR by tracking actual delivery, not just shipment confirmation
- Late deliveries drive negative feedback and A-to-Z claims

### How to Improve
1. Set accurate and realistic delivery time estimates
2. Use reliable carriers with strong on-time performance
3. Ship earlier than required to build buffer time
4. Monitor carrier performance and switch if delivery rates are poor
5. Consider FBA for products where on-time delivery is challenging

---

## Customer Service Dissatisfaction Rate (CSDR)

### What It Is
Measures the percentage of customer contacts where the buyer indicates dissatisfaction with the seller's response.

### How It Works
- After a buyer-seller message exchange, Amazon may survey the buyer
- The buyer rates whether their issue was resolved satisfactorily
- High dissatisfaction rates indicate poor customer service

### Best Practices
1. Respond to all messages within 24 hours (ideally within a few hours)
2. Address the customer's specific issue directly
3. Offer concrete solutions (refund, replacement, tracking info)
4. Be professional and empathetic
5. Follow up to ensure the issue was resolved

---

## Buy Box Impact

Performance metrics directly affect Buy Box eligibility:

| Metric | Threshold for Buy Box Disqualification |
|--------|----------------------------------------|
| ODR | At or above 1% |
| LSR | At or above 4% |
| VTR | Below 95% |
| OTDR | Below 90% |

Losing the Buy Box dramatically reduces sales since the vast majority of purchases go through the Buy Box.

---

## How Metrics Interact with Account Health Rating (AHR)

- **ODR** is the single most important metric -- exceeding 1% is a serious issue
- **Shipping metrics** (LSR, VTR, Cancel Rate, OTDR) collectively assess fulfillment reliability
- **Policy violations** are separate from quantitative metrics but combined in the AHR score
- Poor metrics across multiple categories compound the risk of deactivation
- Strong performance in one area does NOT offset poor performance in another

---

## Monitoring and Reporting

### Where to Find Your Metrics
- **Seller Central > Performance > Account Health**: Summary view
- **Seller Central > Performance > Customer Satisfaction**: ODR details
- **Seller Central > Performance > Shipping Performance**: LSR, VTR, Cancel Rate
- **Downloadable reports**: Available for detailed order-level analysis

### Recommended Monitoring Frequency
- **Daily**: Check Account Health Dashboard for any new warnings
- **Weekly**: Review individual metric trends
- **Monthly**: Deep dive into reports to identify systemic issues
- **Quarterly**: Assess overall performance trajectory and adjust strategies

---

## Key Takeaways

1. **ODR below 1%** is the single most critical metric -- it encompasses negative feedback, A-to-Z claims, and chargebacks.
2. **Ship on time** (LSR below 4%) and confirm with valid tracking (VTR above 95%).
3. **Do not cancel orders** (Cancel Rate below 2.5%) -- keep inventory accurate.
4. **Deliver on time** (OTDR above 90%) -- set realistic delivery estimates.
5. A single defective order counts only once even if it has multiple defect types.
6. **FBA eliminates shipping metric concerns** since Amazon handles fulfillment.
7. Monitor metrics daily and address issues immediately before they compound.

---

## Sources

- https://sell.amazon.com/sell
- https://sellercentral.amazon.com/help/hub/reference/external/G200285250
- https://www.sellerassistant.app/blog/amazon-order-defect-rate-odr-all-you-need-to-know
- https://www.sellerassistant.app/blog/amazon-account-health-a-guide-for-fba-sellers
- https://feedvisor.com/university/seller-performance-measurements/
- https://spctek.com/understanding-amazon-account-health-metrics-that-matter/
- https://www.sellerapp.com/blog/improve-amazon-order-defect-rate/

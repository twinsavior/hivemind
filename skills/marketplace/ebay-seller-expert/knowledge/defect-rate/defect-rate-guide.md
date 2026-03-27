# Defect Rate — Complete Seller Guide

## Overview

Your transaction defect rate is the single most important metric determining your eBay seller level. It directly affects your search visibility, fee structure, and ability to sell. Understanding exactly what counts as a defect, how the rate is calculated, and how to manage it is critical to maintaining a healthy account.

---

## What Counts as a Transaction Defect

eBay tracks three types of defects that factor into your seller level evaluation:

### 1. Cases Closed Without Seller Resolution

**Definition:** An eBay Money Back Guarantee case or PayPal claim that is resolved in the buyer's favor because the seller did not resolve it.

**Scenarios that create this defect:**

| Scenario | Defect? | Why |
|---|---|---|
| Buyer opens "Item Not Received" case, eBay decides in buyer's favor | Yes | You failed to prove delivery |
| Buyer opens "Item Not As Described" case, eBay decides in buyer's favor | Yes | Item did not match listing |
| Buyer opens case, you issue full refund before eBay intervenes | No | You resolved it yourself |
| Buyer opens return request, you accept and refund | No | Normal return, not a case escalation |
| Buyer opens case, then closes it voluntarily | No | Buyer withdrew the case |
| eBay steps in and forces a refund | Yes | Case closed without your resolution |

**Key point:** A buyer opening a return request does NOT create a defect. A defect only occurs when a case is escalated to eBay AND eBay decides against you.

### 2. Late Shipments

**Definition:** An order where the tracking information shows the item was shipped after the expected ship-by date.

**How the ship-by date is calculated:**
- Payment date + your handling time = expected ship-by date.
- If you have 1 business day handling and the item sells on Monday, it must ship by Tuesday end of day.
- Business days exclude weekends and US federal holidays.

**What counts as "shipped":**
- The carrier's first tracking scan must occur by the ship-by date.
- Simply purchasing a label does NOT count as shipped — the carrier must scan the package.

| Scenario | Late Shipment Defect? |
|---|---|
| Tracking shows first scan 1 day after ship-by date | Yes |
| Label purchased on time, but carrier scans next day | Yes |
| Shipped on time, but delivered late | No (not your fault) |
| No tracking uploaded at all | Evaluated as late |
| International shipment with customs delay | No (if initial scan was on time) |

### 3. Seller-Initiated Cancellations

**Definition:** An order cancelled by the seller for a reason indicating the seller was at fault.

| Cancellation Reason | Defect? |
|---|---|
| "Out of stock or item unavailable" | Yes |
| "Something is wrong with the buyer's shipping address" | No |
| "Buyer asked to cancel" | No |
| "Issue with buyer's payment method" | No (rare with Managed Payments) |
| No reason selected (default) | May count as defect |

> **Critical:** Always select the correct cancellation reason. If a buyer asks you to cancel, select "Buyer asked to cancel" to avoid a defect. If the buyer refuses to confirm the cancellation, you may need to ask eBay to intervene.

---

## Defect Rate Calculation

### The Formula

```
Transaction Defect Rate = (Number of Unique Transactions with Defects) / (Total Evaluated Transactions) x 100
```

### Important Calculation Rules

- **One defect per transaction:** Even if a transaction has multiple issues (late AND a case closed against you), it counts as one defect.
- **Unique transactions:** If a buyer purchases 3 items in one order, that is one transaction for defect rate purposes.
- **Evaluation window:** Defect rate is calculated over a rolling period (see Evaluation Periods below).

### Example Calculation

| Period Data | Count |
|---|---|
| Total transactions in evaluation period | 500 |
| Cases closed without resolution | 3 |
| Late shipments | 5 |
| Seller-initiated cancellations (out of stock) | 2 |
| Overlapping (transaction had both late + case) | 1 |
| **Unique defective transactions** | **9** (3 + 5 + 2 - 1 overlap) |
| **Defect rate** | **9 / 500 = 1.8%** |

---

## Evaluation Periods

### Monthly Evaluation Schedule

- Evaluations occur on the **20th of each month**.
- Your new seller level takes effect immediately after evaluation.
- eBay evaluates two lookback periods and uses whichever is more favorable to you:

| Lookback Period | Transactions Required |
|---|---|
| Most recent 3 months | Minimum 50 transactions and 10 unique buyers |
| Most recent 12 months | Minimum 100 transactions and 25 unique buyers |

If you do not meet the minimum transaction thresholds, your previous level is maintained.

### Evaluation Calendar Example

| Evaluation Date | 3-Month Window | 12-Month Window |
|---|---|---|
| March 20, 2026 | Dec 20, 2025 – Mar 19, 2026 | Mar 20, 2025 – Mar 19, 2026 |
| April 20, 2026 | Jan 20, 2026 – Apr 19, 2026 | Apr 20, 2025 – Apr 19, 2026 |

---

## Seller Level Thresholds

### Below Standard

You fall to Below Standard if you exceed ANY of these thresholds:

| Metric | US Site | UK Site | DE Site | AU Site |
|---|---|---|---|---|
| Transaction defect rate | >2% | >2% | >2% | >2% |
| Cases closed without resolution | >0.3% | >0.3% | >0.3% | >0.3% |
| Late shipment rate | >7% | >7% | >7% | >7% |

### Above Standard

| Metric | Threshold |
|---|---|
| Transaction defect rate | <=2% |
| Cases closed without resolution | <=0.3% |
| Late shipment rate | <=7% |

### Top Rated Seller

| Metric | Threshold |
|---|---|
| Transaction defect rate | <=0.5% |
| Cases closed without resolution | <=0.3% |
| Late shipment rate | <=3% |
| Tracking uploaded on time and validated | >=95% |
| Minimum transactions | 100 transactions + 25 unique buyers (12 months) |
| Account age | At least 90 days |

---

## How Defects Impact Your Account

### Below Standard Consequences

| Impact Area | Consequence |
|---|---|
| Final value fees | +4% surcharge on all sales |
| Search visibility | Significant search ranking demotion |
| Promoted Listings | Reduced ad effectiveness |
| Selling limits | May be reduced |
| Top Rated benefits | Lost (10% FVF discount, TRS badge) |
| Buyer trust | No seller level badge displayed |
| Global Shipping Program | May be removed |
| eBay promotions | Excluded from some eBay promotional placements |

### Financial Impact Example

| Scenario | Above Standard | Below Standard | Difference |
|---|---|---|---|
| Monthly sales | $10,000 | $10,000 | — |
| Base FVF (13.25%) | $1,325 | $1,325 | — |
| Below Standard surcharge (4%) | $0 | $400 | +$400/month |
| Estimated lost sales (lower visibility) | $0 | $1,500–$3,000 | Significant |
| **Total monthly impact** | — | — | **$1,900–$3,400** |

---

## How to Check Your Defect Rate

### In Seller Hub

**Navigation:** Seller Hub > Performance > Service metrics

This page shows:
- Your current defect rate with exact numbers (X defects out of Y transactions).
- Each defect category broken down individually.
- Trend indicators (improving or worsening).
- Projected level for the next evaluation.

### Drilling Into Individual Defects

**Navigation:** Seller Hub > Performance > Service metrics > Click on a specific metric

This shows:
- Each individual transaction that has a defect.
- The buyer's username.
- The order date.
- The specific defect type.
- Whether the defect is eligible for appeal.

---

## How to Appeal Defects

### Defects Eligible for Appeal

Not all defects can be appealed. You can appeal when:

| Situation | Appeal Basis |
|---|---|
| Buyer confirmed they received the item after the case closed | Buyer confirmation of receipt |
| Tracking shows delivered but eBay ruled in buyer's favor | Valid tracking proof of delivery |
| Buyer requested cancellation but you accidentally selected wrong reason | Incorrect cancellation reason |
| eBay system error caused incorrect defect | Technical error |
| Late shipment due to carrier issue (no first scan despite drop-off) | Carrier scan failure with proof |
| Buyer committed fraud (account later suspended) | Fraudulent buyer |

### Appeal Process

**Step 1: Identify the defect to appeal.**
- Seller Hub > Performance > Service metrics > Click defect category > Find the specific transaction.

**Step 2: Gather evidence.**
- Tracking numbers showing delivery.
- Screenshots of buyer messages confirming receipt or requesting cancellation.
- Carrier receipts (if carrier failed to scan on time).

**Step 3: Submit the appeal.**
- **Online:** Click the "Request removal" or "Appeal" link next to the defect (if available).
- **Phone:** Call eBay seller support with order number and evidence ready.
- **Chat:** Use eBay Help > Contact us > Seller performance > Chat with agent.

**Step 4: Follow up.**
- Appeals are typically reviewed within 48 hours.
- If approved, the defect is removed retroactively.
- If denied, you can re-appeal with additional evidence or escalate.

---

## Automatic Defect Removal

eBay automatically removes defects in certain scenarios without requiring an appeal:

| Scenario | Automatic Removal? |
|---|---|
| Buyer's account is suspended for fraud | Yes |
| eBay identifies a system error that caused the defect | Yes |
| Buyer retracts the case after it was closed against you | Sometimes (may need appeal) |
| Carrier confirms a shipping delay that was their fault | No (must appeal) |
| Natural disaster or eBay-declared shipping disruption | Yes (for affected regions) |

### eBay Shipping Disruption Policy

During declared events (severe weather, natural disasters, carrier strikes), eBay may:
- Extend handling times for affected areas.
- Remove late shipment defects automatically.
- Pause defect evaluations temporarily.

Check the eBay Seller Announcements board for active disruption declarations.

---

## Tracking Defect Trends in Seller Hub

### Using the Dashboard Effectively

**Navigation:** Seller Hub > Performance > Service metrics

#### Monitoring Schedule

| Frequency | Action |
|---|---|
| Daily | Check for new cases opened; resolve quickly before they become defects |
| Weekly | Review late shipment count; adjust handling time if needed |
| Bi-weekly | Calculate projected defect rate for upcoming evaluation |
| Before the 20th | Full review of all metrics; resolve any open cases; appeal eligible defects |

#### Projecting Your Next Evaluation

Use this worksheet:

```
Current defects: ___
Current transactions: ___
Current rate: ___ / ___ = ___%

Projected new defects before the 20th: ___
Projected new transactions before the 20th: ___
Projected rate: (___ + ___) / (___ + ___) = ___%
```

Compare projected rate against the thresholds to determine your likely seller level.

---

## Strategies to Reduce Defect Rate

### Preventing "Item Not Received" Cases

1. **Always upload tracking** within your handling time.
2. **Use tracked shipping methods** for all shipments (no untracked First Class for items over $10).
3. **Require signature confirmation** for items over $750 (eBay requirement for Seller Protection).
4. **Communicate proactively** if there is a shipping delay.
5. **Respond to "Where is my item?" messages immediately** — resolve before a case opens.

### Preventing "Item Not As Described" Cases

1. **Photograph all defects** on used items from multiple angles.
2. **Describe condition accurately** — err on the side of over-disclosing flaws.
3. **Use correct item specifics** (brand, model, size, color, material).
4. **Test electronics** before shipping.
5. **Package items well** to prevent shipping damage.

### Preventing Late Shipments

1. **Set realistic handling times.** If you cannot ship same-day, set 2 or 3 business day handling.
2. **Print labels and drop off early in the day** to ensure same-day scan.
3. **Use eBay shipping labels** — tracking uploads automatically.
4. **Schedule carrier pickups** if your volume supports it.
5. **Extend handling time before vacations** or busy periods.

### Preventing Cancellation Defects

1. **Keep inventory accurate.** Sync across all platforms in real-time.
2. **Deactivate listings** for items you cannot ship immediately.
3. **If a buyer asks to cancel,** always select "Buyer asked to cancel" as the reason.
4. **Use multi-quantity listings** carefully — track quantity precisely.

---

## Emergency: Approaching Below Standard

If you are near the Below Standard threshold before an evaluation:

### Immediate Actions (Before the 20th)

1. **Appeal all eligible defects** — even one removed defect can make a difference.
2. **Resolve all open cases** — issue refunds if necessary to prevent case closures against you.
3. **Process all pending shipments** with tracking before end of business today.
4. **Increase transaction volume** — each non-defective transaction improves your rate.
5. **Do NOT cancel any orders** — even if it means shipping at a loss.

### Damage Control Math

If you have 8 defects in 400 transactions (2.0% rate):
- Removing 1 defect via appeal: 7/400 = 1.75% (Above Standard).
- Adding 50 clean transactions: 8/450 = 1.78% (Above Standard).
- Both: 7/450 = 1.56% (Above Standard with margin).

---

## Quick Reference: Defect Rate Thresholds

| Seller Level | Defect Rate | Cases Closed w/o Resolution | Late Shipment Rate |
|---|---|---|---|
| Top Rated | <=0.5% | <=0.3% | <=3% |
| Above Standard | <=2% | <=0.3% | <=7% |
| Below Standard | >2% | >0.3% | >7% |

---

## Key Dates

| Date | Significance |
|---|---|
| 20th of each month | Seller level evaluation |
| 30 days after case opened | Maximum time for case resolution before auto-close |
| 3 business days after sale | Maximum handling time for Top Rated sellers |
| End of evaluation period | Last chance to resolve open defects |

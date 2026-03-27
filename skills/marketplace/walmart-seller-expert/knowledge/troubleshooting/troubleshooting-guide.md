# Walmart Marketplace Troubleshooting Guide

## Overview

This guide covers common errors, solutions, and support resources for Walmart Marketplace sellers. It addresses item setup issues, unpublished item troubleshooting, verification errors, and how to get help from Walmart support.

---

## Support Resources

### Primary Support Channels

#### Seller Center Support (Logged In)
1. Select the Help button (question mark icon) in the Seller Center menu bar
2. Choose "Contact support"
3. Describe your issue using at least 5 words and no more than 200 words
4. Depending on the issue, you may access support via email, live chat, or phone

#### Support Without Login
1. Visit the Seller Center login page
2. Select "Contact support"
3. Choose your market and issue category
4. Follow the prompts for assistance

### Additional Help Resources

| Resource | Description |
|----------|-------------|
| **Marty** | GenAI assistant for finding answers, exploring tools, and growing your business |
| **Seller Center Search** | Global keyword search to locate different account sections and access relevant guides |
| **Quick Learn** | Announcements, training videos, and walkthroughs for account management |
| **Marketplace Newsletter** | Monthly updates on news, launches, and seller information (archive available) |
| **Release Notes** | Important notifications, updates, and policy guidelines (automatic opt-in) |
| **Sell Better Blog** | Best practices, case studies, and seller insights |
| **Seller Academy** | Self-paced courses and video tutorials for business growth |
| **Solution Provider Support** | Log into the Solution Provider Center for additional resources |
| **Developer Portal** | Direct API help, tools, and resources at developer.walmart.com |

---

## Common Errors and Solutions

### Unpublished Items

Items can be unpublished from Walmart.com for various reasons. Use the Unpublished Items dashboard in Seller Center or generate an Item Report to identify affected items and their unpublished reasons.

#### Primary Image Missing
- **Problem**: Item lacks required primary image
- **Solution**: Update the item with a new primary image through Seller Center
- **Note**: Walmart determines displayed content unless provided by brand owners or authorized resellers. Locked items may require support assistance.

#### Price Missing
- **Problem**: List price is absent from the listing
- **Solution**: Update your list price in Seller Center

#### Egregious Shipping Cost
- **Problem**: Shipping fees are uncompetitive relative to item price
- **Solution**: Update your shipping template fees to align with market conditions
- **Recovery**: When the shipping fee falls within an acceptable range, Walmart automatically republishes (typically within 48 hours)

#### Reasonable Price Not Satisfied
- **Problem**: Item pricing significantly exceeds competitor prices or historical rates
- **Solution**: Update pricing to be more competitive
- **Recovery**: Walmart automatically republishes within 48 hours if pricing rules are met
- **Tip**: Use the reference price provided on the Unpublished Items dashboard as a competitive benchmark

#### Pricing Error
- **Problem**: Items priced erroneously too low, risking seller losses and order cancellations
- **Solution**: Increase price using reference price signals as benchmarks
- **Alternative**: Submit documentation proving intentional pricing if the low price is deliberate
- **Recovery**: Automatic republishing occurs once pricing rules are satisfied

#### UPC Mismatch
- **Problem**: Product identifier is incorrect or mismatched
- **Solution**: Update the item's product ID and resubmit updated item data through Seller Center or APIs
- **Tip**: Contact manufacturers for correct identifiers if needed; you may appeal if unpublished incorrectly

#### Item End Date Passed
- **Problem**: The item's end date has passed, causing it to go unpublished
- **Solution**: Update the end date or remove it to allow continuous listing

### Monitoring Unpublished Items
- Run Item Reports in Seller Center and review the Status Change column
- Use the Unpublished Items dashboard for real-time status
- If items remain unpublished after 48+ hours and corrections have been made, contact Seller Center support

---

## Item Setup Errors

### Upload Validation
Walmart's system automatically validates templates for:
- Missing required attributes
- Incorrect data types
- Invalid check digits
- Copy-paste errors

### Common Upload Errors

#### Invalid Product ID
- System identifies incorrect Product IDs by row number
- **Solution**: Correct the error in the file, save, and re-upload in Seller Center

#### Missing Attribute Metadata
- Critical: Do not modify rows 1-6 in the upload template
- **Solution**: Download a fresh spreadsheet if uncertain about deletions
- For multi-select attributes, ensure rows 4-6 data is properly copied into new columns

#### Error File Downloads
- When uploads fail, an automated error report downloads automatically
- All cells containing errors are highlighted
- **Solution**: Correct highlighted cells and re-upload

### Common Post-Upload Errors

#### Main Image URL Issues
- Images must meet specific URL requirements
- **Solution**: Review Walmart's image guidelines, update content, re-upload, and verify in the Activity Feed

#### Unauthorized Custom Product IDs
- Private label or handmade items may not have standard product IDs
- **Solution**: Request a UPC/GTIN exemption OR purchase a product ID from GS1 or ISBN authorities

#### Variant Setup Issues
- Items must have a Variant Group ID, Variant Attribute Name, and "Is Primary Variant" value
- **Solution**: Ensure all three variant fields are properly set up

### System Errors
- Walmart's system automatically attempts to reprocess submissions every few hours
- **Solution**: Wait a day; if the problem persists, contact Support with your Feed ID and spreadsheet

### WFS-Specific Item Setup Errors

#### Battery Type Required
- For items containing batteries, select the appropriate battery type from the dropdown
- For non-battery items, choose "Does Not Contain a Battery"

#### Hazmat Assessment
- Items flagged as hazardous materials are held for up to 3 business days
- Walmart's compliance team reviews hazmat items before publishing

#### Chemical/Aerosol/Pesticide Declaration
- Specify hazmat category and answer compliance questions
- Select "Yes" in relevant columns before re-uploading

### Prevention Best Practices
- Verify all required attributes are completed
- Confirm content stays within character limits
- Use dropdown selections; avoid pasting into restricted cells
- Paste values only, not formatting (use Paste Special)
- Avoid special characters like "/" in "N/A"
- For WFS items, complete both category and trade item configuration tabs in matching order

### Error Resolution in Seller Center
1. Access the Activity Feed
2. Filter by "Item Setup"
3. Select the eye icon under "Errors"
4. Enter Single Item Edit mode
5. Red-highlighted sections mark problem areas
6. Fix the issues and resubmit

---

## Product ID Errors

### Common Causes
- Typos in GTIN or UPC numbers
- Copy-and-paste errors
- Non-existent product ID numbers
- Incorrect check digits

### Solutions
- Verify the product ID against the physical product barcode
- Confirm the number with the manufacturer
- Use GS1 to validate GTIN numbers
- Request a GTIN exemption for private label products without standard IDs

---

## Verification Code Errors (2-Step Verification)

### Overview
Walmart requires 2-step verification for Seller Center login. One-time verification codes are sent via email or authenticator app.

### Critical Detail
Verification codes are temporary and expire after 10 minutes. After expiration, return to the Seller Center login screen to request a new code.

### Email-Based Code Not Received

**Possible Causes**
- Inbox may be full
- Emails redirected to spam or junk folders
- Incorrect email address on file

**Solutions**
1. Clear unnecessary emails to free up inbox space
2. Check spam/junk folders
3. Mark messages from `mpportal_donotreply@walmart.com` as "Not Spam"
4. Verify and update the email address associated with your account
5. Whitelist Walmart's email addresses

### Authenticator App Issues

**Possible Causes**
- App is outdated
- App is crashing or malfunctioning

**Solutions**
1. Update the authenticator app to the newest version (Google Play or Apple App Store)
2. Force restart the app if it crashes
3. Uninstall and reinstall the application if problems persist

### Delayed Code Delivery

**Solutions**
1. Check your internet connection; try switching between mobile data and Wi-Fi
2. Wait 24 hours before retrying
3. Review the guide on enabling 2-step verification for setup issues

### Alternative Access
- Select "Try another way" on the verification screen to use an alternative method
- Use the Help button in Seller Center to contact Support if all methods fail

---

## Browser Requirements

### Supported Browsers
- Use the latest version of major browsers (Chrome, Firefox, Safari, Edge)
- Ensure JavaScript is enabled
- Clear cache and cookies if experiencing display or functionality issues

### Common Browser Issues
- Outdated browser versions may cause Seller Center features to malfunction
- Pop-up blockers may interfere with some Seller Center functions
- Third-party browser extensions may conflict with Seller Center

---

## Walmart Seller App Troubleshooting

### Common Issues
- App crashes or freezes
- Unable to log in
- Notifications not working
- Data not syncing

### Solutions
- Update the app to the latest version
- Force close and reopen the app
- Clear the app cache
- Uninstall and reinstall if problems persist
- Verify your internet connection

---

## Common Integration Errors

### Feed Processing Errors
- Check the Activity Feed in Seller Center for processing status
- Review error reports downloaded automatically for failed uploads
- Verify file format and required fields before re-uploading

### API-Related Issues
- See the API Integration guide for detailed API troubleshooting
- Common issues include expired OAuth tokens, rate limiting, and malformed requests

### Solution Provider Issues
- Contact your Solution Provider for integration-specific errors
- Log into the Solution Provider Center for support resources

---

## How to Open a Support Case

### Step-by-Step Process
1. Log into Seller Center
2. Click the Help button (question mark icon) in the menu bar
3. Select "Contact support"
4. Describe your issue clearly (5-200 words)
5. Select the appropriate category for your issue
6. Choose your preferred support method (email, chat, or phone)
7. Submit the case and note your case number for reference

### Tips for Effective Support Cases
- Be specific about the issue (include item IDs, order numbers, or error messages)
- Describe what you have already tried
- Include screenshots if relevant
- Reference the relevant policy or process
- Follow up if you do not receive a response within the expected timeframe

### Support Without Account Access
- Visit the Seller Center login page
- Select "Contact support" without logging in
- Choose your market and issue category
- Follow the prompts to reach support

---

## Key Reminders

1. Use the Unpublished Items dashboard to monitor and fix listing issues
2. Verification codes expire after 10 minutes -- request a new one if expired
3. Most pricing-related unpublishing resolves automatically within 48 hours
4. Do not modify rows 1-6 in upload templates
5. WFS hazmat items are held for up to 3 business days for compliance review
6. Always include specific details (item IDs, error messages) when opening support cases
7. Check the Activity Feed for item setup error details and resolution guidance

---

## Sources

- https://marketplacelearn.walmart.com/guides/Getting%20started/Troubleshooting/Get-help-quick
- https://marketplacelearn.walmart.com/guides/Catalog%20management/Troubleshooting/Troubleshoot-unpublished-items
- https://marketplacelearn.walmart.com/guides/Item%20setup/Troubleshooting/troubleshoot-item-setup-errors
- https://marketplacelearn.walmart.com/guides/Item%20setup/Troubleshooting/Troubleshoot-product-ID-errors
- https://marketplacelearn.walmart.com/guides/Getting%20started/Troubleshooting/Troubleshoot-one-time-verification-code-errors
- https://marketplacelearn.walmart.com/guides/troubleshoot-the-walmart-seller-app
- https://sellerhelp.walmart.com/s/
- https://marketplacelearn.walmart.com/guides

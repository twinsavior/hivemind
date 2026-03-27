# Walmart Marketplace API Integration Guide

## Overview

Walmart Marketplace provides a comprehensive set of APIs enabling third-party sellers and solution providers to programmatically manage listings, orders, fulfillment, pricing, and operations at scale. All APIs use OAuth 2.0 for authentication.

---

## Getting Started

### Prerequisites
1. Active Walmart Marketplace seller account
2. API credentials (Client ID and Client Secret) from the Developer Portal
3. Understanding of OAuth 2.0 authentication
4. Development environment capable of making HTTPS requests

### Integration Methods
- **Direct API Integration**: Build custom integrations using Walmart's REST APIs
- **Solution Provider**: Use an authorized third-party solution provider for managed integration
- **Walmart App Store**: Browse and install pre-built integrations

### Five-Step Integration Approach
1. **Obtain OAuth access token** from the appropriate environment
   - Sandbox: `https://sandbox.walmartapis.com`
   - Production: `https://marketplace.walmartapis.com`
2. **Verify connectivity** with read operations (item listing, feed status checks)
3. **Test safe write operations** on test SKUs (price or inventory updates)
4. **Scale content creation** using catalog feeds, then establish buyable offers
5. **Validate publication** to confirm items have active, searchable status

---

## OAuth 2.0 Authentication

### Overview
OAuth 2.0 is the industry standard used for all Walmart Marketplace API authentication and authorization.

### Key Credentials
- **Client ID**: Public identifier for your application
- **Client Secret**: Private key for authentication
- These replace the older Consumer ID/Private Key combination
- Generated through the Developer Portal at `developer.walmart.com/generateKey`

### Generating API Keys
1. Log into the Walmart Developer Portal
2. Navigate to the API Keys page
3. Click "Add New Key for a Solution Provider" to create credentials
4. Store credentials securely

### Access Token Generation
1. Use the Token API with your Client ID and Client Secret
2. Include the access token in all subsequent API calls via the `WM_SEC.ACCESS_TOKEN` header
3. **Token expiration**: Access tokens are valid for 15 minutes
4. Your integration must handle the `expires_in` field and refresh or regenerate tokens as needed

### Required Headers
When using OAuth authentication, include:
- `WM_SEC.ACCESS_TOKEN` (the generated access token)

Remove legacy headers if migrating:
- Remove: `WM_SEC.TIMESTAMP`, `WM_SEC.AUTH_SIGNATURE`, `WM_CONSUMER.ID`

### Credential Management Best Practices
- Generate separate API keys for each Solution Provider
- Never share keys between providers
- Reset credentials when needed (requires admin access)
- Credentials can be regenerated through the Developer Portal without local storage requirements

---

## API Scopes

### Seller Credentials
- Grant full API access across all functions
- Suitable for direct integrations by the seller

### Solution Provider Credentials
- Start with no permissions by default
- Require explicit scope assignment per object category (Items, Orders, Inventory, etc.)
- Scopes should be set to the minimum level of access required by the application use case
- Enable granular, role-based permissions through delegated access

### Delegated Access
- OAuth 2.0 authorization workflow for the Walmart Marketplace App Store
- Enables sellers to grant third-party applications access to protected data resources
- Industry-standard token-based authorization flow
- Sellers control which scopes are granted to each application

---

## Available API Categories

### Token API
- Generate access tokens for API authentication
- Required as the first step in any API interaction

### Feeds API
- Submit bulk data operations
- Process item creation, updates, and deletions in batch
- Check feed processing status
- Monitor feed errors and success rates

### Items API
- Create and manage item listings on Walmart.com
- Update product attributes, descriptions, and images
- Retrieve item details and status
- GTIN exemption status API with denial reason notifications
- Unpublished item insights retrieval

### Inventory API
- Keep item inventory up-to-date
- Update seller-fulfilled inventory individually or in bulk
- WFS provides automated tracking through health dashboards
- Real-time inventory synchronization

### Prices API
- Manage item pricing
- Update retail prices
- Set comparison prices
- Integrate with the Repricer for automated pricing strategies

### Orders API
- Retrieve and manage customer orders
- Acknowledge orders
- Ship orders with tracking information
- Cancel orders when necessary
- Manage order fulfillment workflow

### Returns API
- Manage product returns
- Process return requests
- Issue refunds
- Track return status

### Promotions API
- Set promotional item prices for events such as clearance sales
- Manage promotional campaigns
- Schedule promotional pricing periods

### Reports API
- Generate business analytics reports
- Access settlement and payment reports
- Download performance reports
- Track sales and revenue data

### Insights API
- Access seller performance metrics
- Seller Performance API covering negative feedback, returns, tracking rates
- Listing Quality score retrieval
- Performance notification webhooks
- Assortment recommendations with variant and trend analysis

### Advertising APIs (SEM)
- Search Engine Marketing campaign management
- Catalog management and item eligibility checking
- Performance reporting and billing history

### WFS APIs
- Walmart Fulfillment Services management
- Inbound shipment creation and tracking
- Inventory management within fulfillment centers
- Return preferences configuration

### Additional APIs
- **Ship with Walmart (SWW)**: Access discounted shipping rates
- **Shipment Protection**: Claims management for shipping issues
- **Disputes**: Resolution tools for order disputes
- **Lag Time Management**: Configure processing time settings
- **Notifications**: Event subscriptions and webhooks
- **Tax Forms**: Access tax documentation
- **Payment Reports**: Financial reporting

---

## Solution Provider Directory

### Overview
Walmart maintains a directory of approved Solution Providers who offer pre-built integrations and managed services.

### Becoming a Solution Provider
1. Access the "Get started as an approved Solution Provider" guide
2. Register your application for the Walmart App Store
3. Complete app registration for publishing
4. Access the Solution Provider Center for support resources

### App Store Publishing
- Solution Providers can publish applications to the Walmart App Store
- Sellers can browse and install apps directly from the marketplace
- Apps require proper scope configuration and security review

---

## Rate Limiting and Throttling

### Monitoring Rate Limits
- Monitor response headers: `x-current-token-count` and `x-next-replenish-time`
- Check the Marketplace Rate Limiting Guide for detailed specifications
- API-specific rate limits apply to different endpoints

### Handling Rate Limits

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| 429 | Rate limit exceeded | Implement exponential backoff with jitter |

### Best Practices
- Implement exponential backoff with jitter for retries
- Respect `Retry-After` headers when present
- Batch operations via feeds for bulk changes
- Keep updates small and frequent for orders and offers
- Avoid burst traffic patterns

---

## Error Codes and Resolution

| Code | Issue | Solution |
|------|-------|----------|
| **400** | Malformed request, wrong headers, missing fields | Validate payloads against schema; set correct Content-Type headers |
| **401** | Expired/invalid token or credentials mismatch | Renew token; verify sandbox/production URLs match |
| **403** | Missing permissions/scopes | Update app roles and reauthorize |
| **404** | Item/offer not found or still ingesting | Check status; items in "InProgress" require waiting |
| **429** | Rate limit exceeded | Implement exponential backoff with jitter |

### General Error Handling
- Always validate request payloads against the API schema before sending
- Check that Content-Type and other required headers are correctly set
- Ensure the correct environment URL is being used (sandbox vs. production)
- For 404 errors on recently created items, allow time for ingestion processing

---

## Testing and Sandbox

### Sandbox Environment
- URL: `https://sandbox.walmartapis.com`
- Use for testing before deploying to production
- Separate credentials may be needed for sandbox vs. production

### Testing Best Practices
- Use Postman collections or curl snippets for initial testing
- Consult the API reference for request/response samples
- Test with non-production SKUs when possible
- Validate all workflows end-to-end before production deployment

### Production Environment
- URL: `https://marketplace.walmartapis.com`
- Use only after thorough sandbox testing
- Monitor API health dashboard for real-time performance

---

## API Health Monitoring

### API Health Dashboard
- Real-time performance monitoring available through the Developer Portal
- Track API response times, error rates, and availability
- Use to diagnose integration issues

### Changelog and Release Notes
- Available through the Developer Portal footer
- Track API updates, deprecations, and new features
- Subscribe to stay informed of changes that may affect your integration

---

## Integration Best Practices

### General
1. Always use OAuth 2.0 for authentication; legacy authentication is deprecated
2. Handle token expiration gracefully (15-minute validity)
3. Implement proper error handling for all API responses
4. Use the sandbox environment for development and testing
5. Monitor rate limits and implement backoff strategies
6. Use feeds for bulk operations rather than individual API calls
7. Keep API credentials secure and rotate as needed

### Performance
1. Batch operations whenever possible
2. Use feeds for bulk item, inventory, and price updates
3. Avoid making unnecessary API calls
4. Cache data locally when appropriate to reduce API load
5. Process webhook notifications asynchronously

### Security
1. Store Client ID and Client Secret securely
2. Generate separate credentials for each Solution Provider
3. Use minimum required scopes for delegated access
4. Rotate credentials if a security breach is suspected
5. Never expose API credentials in client-side code

---

## Key Reminders

1. All APIs require OAuth 2.0 authentication; access tokens expire after 15 minutes
2. Use the sandbox environment (`sandbox.walmartapis.com`) for testing before production
3. Seller credentials grant full access; Solution Provider credentials require explicit scope assignment
4. Implement exponential backoff with jitter for rate limit handling
5. Use the Feeds API for bulk operations (items, inventory, prices)
6. Monitor the API health dashboard and changelog for updates
7. The Developer Portal at `developer.walmart.com` is the primary resource for documentation

---

## Sources

- https://developer.walmart.com/
- https://developer.walmart.com/us-marketplace
- https://developer.walmart.com/us-marketplace/docs/introduction-to-marketplace-apis
- https://developer.walmart.com/us-marketplace/docs/oauth-authentication
- https://developer.walmart.com/us-marketplace/docs/oauth-20-authorization
- https://developer.walmart.com/us-marketplace/docs/api-integration-usage
- https://marketplacelearn.walmart.com/guides/Getting%20started/Getting%20ready%20to%20sell/Integration-methods-API
- https://marketplacelearn.walmart.com/guides

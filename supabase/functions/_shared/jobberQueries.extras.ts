// Large-company setup: the documents for the Jobber parts that need permissions TreeCheck's Jobber app gets after
// Jobber's review (productionJobberExtras.ts): Users, Requests, Products & Services and Custom Fields. Switched off
// until production_rollout.jobber_extras is true. Pure: strings only, no Deno globals. Checked against Jobber API
// version 2026-09-25 by tools/jobber-schema/validate-queries.mjs in the engagement folder. Maintained outside Lovable.

/** One small read per permission: each answers, or fails when the company's connection lacks that permission. */
export const TC_ExtrasProbeUsers = `
  query TC_ExtrasProbeUsers { users(first: 1, filter: { status: ACTIVATED }) { nodes { id } } }`;
export const TC_ExtrasProbeRequests = `
  query TC_ExtrasProbeRequests { requests(first: 1) { nodes { id } } }`;
export const TC_ExtrasProbeProducts = `
  query TC_ExtrasProbeProducts { products(first: 1) { nodes { id } } }`;
export const TC_ExtrasProbeFields = `
  query TC_ExtrasProbeFields { customFieldConfigurations(first: 1, filter: { appliesTo: ALL_QUOTES }) { nodes { __typename } } }`;

/** The company's products and services, a page at a time. */
export const TC_ExtrasProducts = `
  query TC_ExtrasProducts($after: String) {
    products(first: 100, after: $after) {
      nodes { id name category visible }
      pageInfo { hasNextPage endCursor }
    }
  }`;

/** The company's active Jobber users. */
export const TC_ExtrasUsers = `
  query TC_ExtrasUsers {
    users(first: 100, filter: { status: ACTIVATED }) {
      nodes { id isAccountOwner name { full } email { raw } }
    }
  }`;

/** Requests made since a moment, newest first, with the contact and property a new estimate starts from. */
export const TC_ExtrasRequests = `
  query TC_ExtrasRequests($after: ISO8601DateTime!) {
    requests(first: 50, filter: { createdAt: { after: $after } }, sort: [{ key: REQUESTED_AT, direction: DESCENDING }]) {
      nodes {
        id title createdAt requestStatus contactName email phone
        client { id name emails { address } phones { number } }
        property { id address { street1 street2 city province postalCode } }
      }
    }
  }`;

/** One request, to check it before a quote names it. A deleted request is null. */
export const TC_ExtrasRequest = `
  query TC_ExtrasRequest($id: EncodedId!) {
    request(id: $id) { id requestStatus client { id } property { id } }
  }`;

/** The quote fields this app made before (archived ones too, to bring them back rather than make twins). */
export const TC_ExtrasQuoteFields = `
  query TC_ExtrasQuoteFields {
    customFieldConfigurations(first: 50, filter: { appliesTo: ALL_QUOTES, createdByThisApp: true }) {
      nodes {
        ... on CustomFieldConfigurationText { id name archived valueType }
        ... on CustomFieldConfigurationLink { id name archived valueType }
      }
    }
  }`;

export const TC_ExtrasFieldCreateText = `
  mutation TC_ExtrasFieldCreateText($input: CustomFieldConfigurationCreateTextInput!) {
    customFieldConfigurationCreateText(input: $input) {
      customFieldConfiguration { id name }
      userErrors { message path }
    }
  }`;

export const TC_ExtrasFieldCreateLink = `
  mutation TC_ExtrasFieldCreateLink($input: CustomFieldConfigurationCreateLinkInput!) {
    customFieldConfigurationCreateLink(input: $input) {
      customFieldConfiguration { id name }
      userErrors { message path }
    }
  }`;

export const TC_ExtrasFieldUnarchive = `
  mutation TC_ExtrasFieldUnarchive($ids: [EncodedId!]!) {
    customFieldConfigurationUnarchive(customFieldConfigurationIds: $ids) {
      customFieldConfigurations { __typename }
      userErrors { message path }
    }
  }`;

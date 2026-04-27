// GraphQL queries against the Kuali Build instance API.
// Adapted from the kuali-build-report repo (2022) and updated for Kuali Build's
// current schema. Each query is exported as a plain string.
//
// Conventions:
// - Connection-style queries take {limit, skip, sort, query} where supported
// - Single-record lookups take {id}
// - Keep selections lean; expand only what the consumer needs

// ---------- Spaces ----------

// List the spaces in the tenant. Used to fan out per-space integration calls
// from the home page (see getIntegrations note below).
export const getSpaces = `
  query GetSpaces {
    spaces {
      id
      name
      integrationCount
    }
  }
`;

// ---------- Integrations ----------

// List integrations with text search and a single-field sort.
//
// Real shape (verified against Davidson tenant 2026-04-26, see Entries 12 and
// 23 in gen-ai-collaboration-notes.md):
//   - `args` accepts `query: String` (the search field — NOT `q`) and
//     `sort: String` (single value, NOT `[String!]`). It does not accept
//     `limit` or `skip` — pagination is not supported on this connection.
//   - `spaceId` is a top-level arg, NOT inside `args`. Without `spaceId` the
//     connection returns only the home-space integrations. To list all
//     integrations across spaces, query `spaces` first and call this per
//     space (see pages/index.vue).
export const getIntegrations = `
  query GetIntegrations($spaceId: ID, $sort: String, $query: String) {
    integrationsConnection(spaceId: $spaceId, args: { sort: $sort, query: $query }) {
      edges {
        node {
          id
          name
          description
          kuali
        }
      }
      totalCount
    }
  }
`;

// Get a single integration with its sharing info and the apps that reference it.
// `data` is the full bridge JSON blob (contains __spaceId, __type, etc.) — parse
// downstream as needed.
export const getIntegration = `
  query GetIntegration($id: ID!) {
    integration(id: $id) {
      id
      name
      description
      data
      kuali
      sharedWithOthers {
        type
        apps {
          id
          name
          tileOptions {
            backgroundColor
            iconName
          }
        }
      }
      appsUsing {
        id
        name
        tileOptions {
          backgroundColor
          iconName
        }
      }
    }
  }
`;

// ---------- Apps ----------

// Single app lookup with the data we need to answer "is this app actively used?"
// — published status, total submissions, last-touched timestamps, plus the form
// schema and workflow JSON so we can introspect for integration-output usage.
export const getApp = `
  query GetApp($id: ID!) {
    app(id: $id) {
      id
      name
      createdAt
      updatedAt
      createdBy { id displayName username }
      updatedBy { id displayName username }
      dataset { isPublished }
      formContainer {
        schema {
          type
          details
          label
          formKey
        }
      }
      workflow
      documentConnection(args: { limit: 1, sort: ["-meta.serialNumber"] }) {
        totalCount
        edges {
          node {
            createdAt
          }
        }
      }
    }
  }
`;

// ---------- Viewer (whoami) ----------

// Confirm whose token the API key represents. Useful sanity check on connect.
export const getViewer = `
  query GetViewer {
    viewer {
      id
      user {
        id
        displayName
        username
        email
      }
    }
    tenant {
      id
      features {
        lasso
      }
    }
  }
`;

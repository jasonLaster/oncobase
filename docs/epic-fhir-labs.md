# Epic FHIR Lab Ingestion

Oncobase can ingest Diana's UCSF lab results through a patient-authorized
SMART on FHIR connection.

## Runtime Routes

- `GET /api/integrations/epic/authorize`
  Starts the UCSF MyChart OAuth flow. Requires an admin session.
- `GET /api/integrations/epic/callback`
  Handles the Epic OAuth callback, stores encrypted token state, and redirects
  back to the wiki.
- `GET|POST /api/integrations/epic/sync`
  Refreshes the Epic access token and imports recent `Observation` laboratory
  results plus `DiagnosticReport` results. Requires `EPIC_FHIR_SYNC_SECRET`,
  `CRON_SECRET`, or an admin session.

## Required Environment

Generate the encryption key with:

```sh
openssl rand -base64 32
```

Set these variables in production:

- `EPIC_FHIR_TOKEN_ENCRYPTION_KEY`
- `EPIC_FHIR_CLIENT_ID`
- `EPIC_FHIR_CLIENT_SECRET`, if the Epic app is confidential
- `EPIC_FHIR_REDIRECT_URI`, for production this should be
  `https://diana-tnbc.com/api/integrations/epic/callback`
- `EPIC_FHIR_SYNC_SECRET` or `CRON_SECRET`

Defaults already point at the UCSF R4 endpoint:

```text
https://unified-api.ucsf.edu/clinical/apex/api/FHIR/R4
```

## Epic App Registration

Register a patient-facing SMART on FHIR app with Epic. Use the production
redirect URI above and include patient read scopes for `Patient`, `Observation`,
`DiagnosticReport`, `DocumentReference`, and `Binary`, plus `offline_access`.

After the Epic client ID is active at UCSF, visit:

```text
/api/integrations/epic/authorize
```

Sign in through UCSF MyChart and approve access. The hourly cron then keeps
the lab tables synchronized.

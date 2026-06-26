# SiteComply — Azure deployment guide

This guide deploys SiteComply to **Azure App Service (Linux, Node 20)** with
**Azure Database for PostgreSQL Flexible Server**, **Azure Communication
Services** (SMS), **Microsoft Entra ID / Azure AD** (admin SSO) and **Azure Key
Vault** for secrets.

> Principle: **no secrets in source or in plain App Settings** — store them in
> Key Vault and reference them from App Service configuration.

---

## 1. Architecture

```
 Worker phone ─┐                          ┌─ Azure Communication Services (SMS OTP)
               ├─► Azure App Service ──────┼─ Azure Database for PostgreSQL (Prisma)
 Admin browser ┘   (Next.js, Node 20)      ├─ Microsoft Entra ID (admin SSO via MSAL)
                                           └─ Azure Key Vault (secrets)
```

The frontend, API (route handlers), auth and data layers live in one Next.js app
but are cleanly separated (`app/`, `services/`, `lib/`, `prisma/`) so the API
could later be extracted into its own service.

---

## 2. Prerequisites

- An Azure subscription and the **Azure CLI** (`az login`).
- Node.js 20 LTS locally (see `.nvmrc`).
- The repository built cleanly: `npm ci && npm run build`.

Set some shell variables used below:

```bash
RG=sitecomply-rg
LOC=uksouth
APP=sitecomply-web                 # must be globally unique
PG=sitecomply-pg                   # must be globally unique
KV=sitecomply-kv                   # must be globally unique
az group create -n $RG -l $LOC
```

---

## 3. Provision Azure resources

### 3.1 PostgreSQL (Azure Database for PostgreSQL Flexible Server)

```bash
az postgres flexible-server create \
  -g $RG -n $PG -l $LOC \
  --tier Burstable --sku-name Standard_B1ms \
  --version 16 --storage-size 32 \
  --admin-user scadmin --admin-password '<STRONG-PASSWORD>' \
  --database-name sitecomply
# Allow Azure services (App Service) to reach it:
az postgres flexible-server firewall-rule create \
  -g $RG -n $PG --rule-name allow-azure \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

Connection string (note `sslmode=require`):

```
postgresql://scadmin:<PASSWORD>@<PG>.postgres.database.azure.com:5432/sitecomply?sslmode=require
```

### 3.2 Azure Communication Services (SMS)

1. Create an ACS resource and **get a phone number with SMS** capability
   (UK numbers or an alphanumeric sender id, subject to ACS availability).
2. Note the **connection string** and the **sender** (E.164, e.g. `+447...`).

```bash
az communication create -g $RG -n sitecomply-acs --location global --data-location uk
az communication list-key -g $RG -n sitecomply-acs   # -> primaryConnectionString
```

### 3.3 Microsoft Entra ID (Azure AD) app registration — admin SSO

1. **App registrations → New registration.** Single tenant (or multi-tenant per
   your needs).
2. **Redirect URI** (Web): `https://<APP>.azurewebsites.net/api/admin/auth/callback`
   (add `http://localhost:3000/api/admin/auth/callback` for local dev).
3. **Certificates & secrets → New client secret** — copy the value.
4. Record: **Directory (tenant) ID**, **Application (client) ID**, the **secret**.
5. API permissions: delegated `openid`, `profile`, `email`, `User.Read` (granted
   by default for the OpenID set).

### 3.4 Key Vault

```bash
az keyvault create -g $RG -n $KV -l $LOC
az keyvault secret set --vault-name $KV -n DATABASE-URL        --value '<postgres-url>'
az keyvault secret set --vault-name $KV -n AZURE-AD-CLIENT-SECRET --value '<aad-secret>'
az keyvault secret set --vault-name $KV -n ACS-CONNECTION-STRING  --value '<acs-conn>'
az keyvault secret set --vault-name $KV -n SESSION-SECRET      --value "$(openssl rand -base64 32)"
```

### 3.5 App Service (Linux, Node 20)

```bash
az appservice plan create -g $RG -n sitecomply-plan --is-linux --sku B1
az webapp create -g $RG -p sitecomply-plan -n $APP --runtime "NODE:20-lts"
# Managed identity so App Service can read Key Vault:
az webapp identity assign -g $RG -n $APP
PRINCIPAL=$(az webapp identity show -g $RG -n $APP --query principalId -o tsv)
az keyvault set-policy -n $KV --object-id $PRINCIPAL --secret-permissions get list
```

---

## 4. Configuration & secrets (environment variables)

Set **non-secret** values directly; set **secrets** as Key Vault references.

```bash
BASE=https://$APP.azurewebsites.net
az webapp config appsettings set -g $RG -n $APP --settings \
  APP_BASE_URL=$BASE \
  NODE_ENV=production \
  SMS_PROVIDER=acs \
  ACS_SMS_SENDER='+447...' \
  AZURE_AD_TENANT_ID='<tenant-id>' \
  AZURE_AD_CLIENT_ID='<client-id>' \
  AZURE_AD_REDIRECT_URI="$BASE/api/admin/auth/callback" \
  OTP_TTL_SECONDS=300 OTP_LENGTH=6 \
  DATABASE_URL="@Microsoft.KeyVault(VaultName=$KV;SecretName=DATABASE-URL)" \
  AZURE_AD_CLIENT_SECRET="@Microsoft.KeyVault(VaultName=$KV;SecretName=AZURE-AD-CLIENT-SECRET)" \
  ACS_CONNECTION_STRING="@Microsoft.KeyVault(VaultName=$KV;SecretName=ACS-CONNECTION-STRING)" \
  SESSION_SECRET="@Microsoft.KeyVault(VaultName=$KV;SecretName=SESSION-SECRET)"
```

Full variable reference (see also [`.env.example`](./.env.example)):

| Variable                        | Secret? | Source      | Notes                       |
| ------------------------------- | ------- | ----------- | --------------------------- |
| `APP_BASE_URL`                  | no      | App Setting | Public HTTPS base URL       |
| `NODE_ENV`                      | no      | App Setting | `production`                |
| `DATABASE_URL`                  | **yes** | Key Vault   | include `?sslmode=require`  |
| `SESSION_SECRET`                | **yes** | Key Vault   | ≥16 chars; cookie signing   |
| `AZURE_AD_TENANT_ID`            | no      | App Setting | from app registration       |
| `AZURE_AD_CLIENT_ID`            | no      | App Setting | from app registration       |
| `AZURE_AD_CLIENT_SECRET`        | **yes** | Key Vault   | client secret               |
| `AZURE_AD_REDIRECT_URI`         | no      | App Setting | must match the registration |
| `SMS_PROVIDER`                  | no      | App Setting | `acs` in production         |
| `ACS_CONNECTION_STRING`         | **yes** | Key Vault   | ACS resource                |
| `ACS_SMS_SENDER`                | no      | App Setting | E.164 / sender id           |
| `OTP_TTL_SECONDS`, `OTP_LENGTH` | no      | App Setting | OTP behaviour               |

---

## 5. Build, migrate & start

### Database migrations

Run migrations as a **release step** (not on every instance start, to avoid
multi-instance races):

```bash
DATABASE_URL='<postgres-url>' npm run db:deploy   # prisma migrate deploy
```

> Optionally seed reference data once: `DATABASE_URL=... npm run db:seed`
> (the seed is sample data — usually only for demo environments).

### Startup command

In **App Service → Configuration → General settings → Startup Command**:

```
npm run start
```

`next start` binds to the `PORT` provided by App Service automatically. The
`postinstall` hook runs `prisma generate` so the client is built during deploy.

### Deploy

Use GitHub Actions (recommended) or zip deploy. Minimal CI outline:

```yaml
# .github/workflows/deploy.yml (outline)
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: 20 }
  - run: npm ci
  - run: npm run build
  - run: DATABASE_URL=${{ secrets.DATABASE_URL }} npm run db:deploy
  - uses: azure/webapps-deploy@v3
    with:
      app-name: sitecomply-web
      package: .
```

---

## 6. Health checks

Point **App Service → Health check** at `/api/health` (returns `{"status":"ok"}`
without touching the database, so a transient DB blip won't cycle instances).

---

## 7. Post-deploy verification

- [ ] `GET https://<APP>.azurewebsites.net/api/health` → `200 {"status":"ok"}`.
- [ ] `/` renders the SiteComply shell over HTTPS.
- [ ] Worker: request an SMS code on a real UK mobile, verify, complete an
      induction, and reach the "compliant and checked in" confirmation in under
      two minutes; then check out.
- [ ] Admin: `/admin` redirects to Microsoft sign-in; after SSO you land on the
      dashboard and can create a site, edit its checklist, see "On site now" and
      export submissions as CSV.
- [ ] Dates show `DD/MM/YYYY`, times 24h in Europe/London (BST/GMT correct).
- [ ] No secrets present in App Settings as plain text (all Key Vault refs).

---

## 8. Security & operations notes

- **Secrets** only in Key Vault; rotate the AAD client secret and
  `SESSION_SECRET` periodically.
- Enforce **HTTPS only** on the Web App; App Service provides TLS.
- Restrict PostgreSQL networking (Private Endpoint / VNet integration) for
  production rather than the broad "allow Azure services" rule.
- Scale out is safe: sessions are stateless signed cookies and OTP/state are in
  the database; run DB migrations as a single release step.
- **UK data residency:** choose UK regions (e.g. `uksouth`) and ACS UK data
  location to keep personal data in the UK (UK GDPR).
- Personal data is erasable from the admin UI (right to erasure) — see
  [LOCALISATION.md](./LOCALISATION.md).

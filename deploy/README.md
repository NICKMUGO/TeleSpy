# Deploying TeleSpy on Azure for Students

Everything runs on one small Azure VM, inside the free allowance of an
Azure for Students subscription: 750 hours a month of a free-tier VM size
(this one is Standard_B2ats_v2, 2 vCPU / 1 GB) and two 64 GB P6 SSDs, for
12 months.

**Live server:** `telespy-ke.centralindia.cloudapp.azure.com` (IP
`4.213.4.170`, resource group `telespy-centralindia`), serving
https://telespy.co.ke once its DNS points there.

```
Internet ──443──> Caddy (HTTPS, Let's Encrypt)
                   ├── /api/*  ──> api   (.NET, port 8080) ──> db (Postgres 17), redis
                   └── else    ──> web   (Next.js, port 3000)
cron ──> ml (billing, anomaly detection, profiling, forecasting) ──> db
```

| File | What it does |
|---|---|
| `azure-provision.sh` | Creates the resource group, VM, public DNS name and firewall rules (run once) |
| `cloud-init.yml` | Sets up the VM on first boot: Docker, swap, timezone, log rotation |
| `docker-compose.yml` | The production stack, in `/opt/telespy` on the VM |
| `Caddyfile` | HTTPS and the `/api` routing |
| `ml.crontab` | The schedule for the ML batch jobs |
| `.env.example` | Template for the server's secrets file |
| `../.github/workflows/deploy.yml` | Builds the images, pushes them to GHCR and rolls the VM forward |

## 1. Create the server (once)

You need the Azure CLI (`az`). Then run:

```bash
az login                      # pick the Azure for Students subscription
./deploy/azure-provision.sh
```

The script prints the server's DNS name, for example
`telespy-ke.centralindia.cloudapp.azure.com`. It also prints the
path of the SSH key it created, `~/.ssh/telespy_azure`.

If Azure rejects the region with a policy error, set `LOCATION` to one of
your allowed regions and run the script again. The script's header shows
how to list the allowed regions.

## 2. GitHub settings (once)

Go to Settings → Secrets and variables → Actions on the repository:

- **Secret** `SERVER_HOST`: the DNS name from step 1.
- **Secret** `SERVER_SSH_KEY`: the contents of `~/.ssh/telespy_azure`, the private key.

## 3. Server secrets (once)

```bash
ssh -i ~/.ssh/telespy_azure azureuser@<SERVER_HOST>
nano /opt/telespy/.env        # paste deploy/.env.example, fill in every <…>
chmod 600 /opt/telespy/.env
```

Generate each secret separately with `openssl rand`. Keep a copy of
`FIELD_ENCRYPTION_KEY` and `BLIND_INDEX_KEY` somewhere safe. Without them,
the encrypted data can't be read.

Mail has to really send (`MAIL_SUPPRESS_SEND=false`), because sign-in
uses an emailed code. Gmail with an App Password on port 587 works.

## 4. Deploy

Go to Actions → Deploy → Run workflow. The first run builds all three
images, and every push to `main` after that redeploys only what changed.
On each start, the API applies any pending database migrations. The first
start also creates the Admin from `BOOTSTRAP_ADMIN_EMAIL` and emails them
a set-password link.

Then open `https://<SITE_DOMAIN>`.

## Optional: demo data

Copy the preprocessed CDR dataset to the server and seed it:

```bash
ssh -i ~/.ssh/telespy_azure azureuser@<SERVER_HOST> mkdir -p /opt/telespy/data/processed
scp -i ~/.ssh/telespy_azure ML/data/processed/cdr_preprocessed.csv \
    azureuser@<SERVER_HOST>:/opt/telespy/data/processed/
ssh -i ~/.ssh/telespy_azure azureuser@<SERVER_HOST>
cd /opt/telespy
docker compose run --rm api --seed
docker compose --profile jobs run --rm ml python training/billing.py
```

## Day to day

```bash
cd /opt/telespy
docker compose ps                         # what's running
docker compose logs -f api                # API logs (also web, caddy, db)
tail -f /var/log/telespy/anomaly.log      # ML job logs
docker compose exec db pg_dump -U telespy telespy | gzip > backup-$(date +%F).sql.gz
```

**Credit:** a free-tier VM that runs all month uses about 730 of the 750 free hours,
so leave only one VM running. Check what's left under Cost Management in
the Azure portal. If you stop the VM, use **Stop (deallocate)** in the
portal or `az vm deallocate`, so the hours stop counting.

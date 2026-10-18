# Low-cost deployment

The frontend is static files, so it can be hosted for free. The backend needs a VPS with **8 GB+ RAM**.
Pick a region in India so audio uploads have low latency.

```
Phone / laptop ──HTTPS──► app.example.com  (Netlify or Cloudflare Pages, free)
               ──HTTPS──► api.example.com  (VPS: Caddy ► FastAPI + Whisper, Ollama)
```

## 1. Backend on a VPS

### Choosing a server

| Workload | RAM | Suggested settings |
|---|---|---|
| Light (a few meetings/day, CPU only) | 8 GB, 4 vCPU | `WHISPER_MODEL=base` or `small`, `OLLAMA_MODEL=qwen2.5:3b` |
| Recommended (CPU) | 16 GB, 4–8 vCPU | `WHISPER_MODEL=small`, `OLLAMA_MODEL=qwen2.5:7b` |
| Fast | GPU with 8 GB+ VRAM | `WHISPER_MODEL=large-v3-turbo`, `qwen2.5:7b`, `INSTALL_EXTRAS=gpu` + `docker-compose.gpu.yml` |

Providers with Indian regions (check current prices; they change often):

- **Oracle Cloud Free Tier:** Mumbai or Hyderabad. The Always-Free Ampere A1 allowance (up to 4 ARM
  cores / 24 GB RAM) can run the recommended setup at no cost if capacity is available. All images
  used here support ARM64.
- **DigitalOcean (Bangalore, BLR1)**, **AWS Lightsail / EC2 (Mumbai, Hyderabad)**,
  **Azure (Central India, Pune)**, **Google Cloud (Mumbai, Delhi)**, **Linode/Akamai (Mumbai)**,
  **Contabo (Mumbai)**: an 8–16 GB plan is typically the cheapest paid option.
- Allow **25 GB+ of disk**: Docker images about 3 GB, `qwen2.5:7b` about 4.7 GB, Whisper `small` about 0.5 GB.

### Steps (Ubuntu 22.04/24.04)

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2. Get the code
git clone https://github.com/selvayashu/MeetingNotes.git && cd MeetingNotes
cp .env.example .env
```

Edit `.env`:

```ini
DOMAIN=api.example.com                    # DNS A record → this server's IP
ACCESS_TOKEN=<long random string>         # e.g. openssl rand -hex 24
CORS_ORIGINS=https://app.example.com      # your frontend URL
OLLAMA_MODEL=qwen2.5:7b                   # or qwen2.5:3b on 8 GB
WHISPER_MODEL=small
API_BIND=127.0.0.1                        # only Caddy talks to the API
```

```bash
# 3. Open the firewall for HTTP/HTTPS (Let's Encrypt needs port 80)
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
#    (On Oracle Cloud, also add ingress rules for 80/443 in the VCN security list.)

# 4. Build, start with automatic HTTPS, pull the models
./setup.sh --https

# 5. Check
curl -H "Authorization: Bearer <ACCESS_TOKEN>" https://api.example.com/api/health
```

Updating: `git pull && docker compose --profile https up -d --build`.

**Swap on 8 GB servers.** Add 4–8 GB of swap so model loading doesn't hit the out-of-memory killer:
```bash
sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Frontend on Netlify (free)

1. Push the repo to GitHub, then in Netlify choose **Add new site → Import from Git** and pick `selvayashu/MeetingNotes`.
2. The root [netlify.toml](../netlify.toml) already sets base `frontend`, command `npm ci && npm run build`,
   publish `dist`, and the SPA redirect.
3. Under **Site settings → Environment variables**, add `VITE_DEFAULT_SERVER_URL=https://api.example.com`.
4. Deploy, and optionally add a custom domain (`app.example.com`). HTTPS is automatic.

## 2b. Frontend on Cloudflare Pages (free)

1. In **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
2. Build settings: root directory `frontend`, build command `npm run build`, output directory `dist`.
3. Environment variables: `NODE_VERSION=20`, `VITE_DEFAULT_SERVER_URL=https://api.example.com`.
4. Pages serves `index.html` for unknown routes when there is no `404.html`, so the SPA routes work.
   `public/_headers` sets the service worker and manifest cache headers.

> Don't put the **API** behind Cloudflare's orange-cloud proxy on the free plan. It limits uploads to
> 100 MB and requests to 100 s. Use DNS-only (grey cloud) for `api.example.com`; Caddy provides HTTPS.

## 3. Connect the app

Open the deployed app, go to **Settings**, enter the server URL and access token, and press
**Test connection**. Then install it from the browser's install prompt (or Share → Add to Home Screen on iOS).

## Costs at a glance

| Item | Cost |
|---|---|
| Frontend hosting (Netlify / Cloudflare Pages) | Free |
| TLS certificates (Let's Encrypt via Caddy) | Free |
| Models and software | Free (open source) |
| Domain | ~₹100–900/year depending on TLD |
| VPS | ₹0 (Oracle Free Tier, if available) to a few thousand ₹/month for 16 GB elsewhere |

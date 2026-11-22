# AWS Field Presales Command Centre

Unified authentication portal, application gateway, and user management console for the **Redington AWS Field Presales Team**.

---

## 1. Overview & Architecture

The **AWS Field Presales Command Centre** provides centralized access control, user authentication, and application routing for internal presales tools:
* **AWS Tech Horizon**: Monthly cloud technology and partner intelligence publication.
* **Monthly Report Generator**: Presales activity, pipeline velocity, and executive brief generator.

### Technical Stack
* **Runtime**: Node.js 24 LTS
* **Web Framework**: Express 4.x
* **Database**: SQLite 3 with WAL mode enabled (`PRAGMA journal_mode = WAL;`) via `better-sqlite3`
* **Authentication**: Cookie-based sessions with SHA-256 token hashing, bcrypt password hashing (12 salt rounds)
* **Reverse Proxy**: Nginx 1.24+ (EC2 host) on TCP Port 443 (HTTPS) with direct IP SAN SSL (`13.235.2.205`)
* **Target Hardware**: Optimized for AWS EC2 `t2.micro` (1 vCPU, 1 GB RAM, Ubuntu 24.04 LTS)

---

## 2. Directory Structure

```text
command-centre/
├── .env.example                  # Environment configuration template
├── .gitignore                    # Git exclusions (node_modules, data, logs, .env)
├── package.json                  # Dependencies & npm scripts
├── README.md                     # Deployment & operations documentation
├── public/
│   ├── assets/
│   │   └── redington-logo.png    # Redington corporate branding logo
│   └── css/
│       └── style.css             # Unified light-green corporate theme
├── views/
│   ├── login.html                # Team sign-in interface
│   ├── dashboard.html            # Portal launchpad with app access tiles
│   ├── admin.html                # User provisioning & audit console
│   └── profile.html              # Profile settings & password change
└── src/
    ├── config.js                 # Environment config loader (zero dependencies)
    ├── database.js               # SQLite connection, WAL mode, schema & session pruner
    ├── server.js                 # Express HTTP server & route mounting
    ├── middleware/
    │   └── auth.js               # Session validation, RBAC, first-login enforcement
    ├── routes/
    │   ├── auth.js               # Login, logout, password change, /verify
    │   ├── admin.js              # User CRUD, password resets, audit log API
    │   ├── profile.js            # Profile update API
    │   └── views.js              # HTML page serving & app launch routes
    ├── services/
    │   └── credentialGenerator.js # 16-char secure temp password & TXT generator
    └── scripts/
        └── seed-admin.js         # Initial administrator bootstrap CLI script
```

---

## 3. Environment Variables Reference

Copy `.env.example` to `.env` on your deployment host and adjust as needed:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port Express listens on (internal `127.0.0.1:3000` behind Nginx) |
| `HOST` | `127.0.0.1` | Bind address. Kept local so only Nginx reverse proxy can reach it |
| `DB_PATH` | `/var/data/command-centre/command_centre.db` | Path to persistent SQLite database file |
| `PORTAL_URL` | `https://13.235.2.205` | Base URL of the portal |
| `SESSION_SECRET` | *(64-hex string)* | Encryption secret for cookie signing |
| `SESSION_MAX_AGE_DAYS`| `7` | Session duration in days before re-authentication is required |
| `COOKIE_SECURE` | `true` | Enforces `Secure` flag on session cookies (must be `true` for HTTPS) |
| `INITIAL_ADMIN_USERNAME`| `Rupak` | Default username for `seed-admin.js` |
| `INITIAL_ADMIN_EMAIL` | `rupak@redington.com` | Default admin email for `seed-admin.js` |
| `INITIAL_ADMIN_PASSWORD`| `Admin@Presales2026!` | Initial bootstrap password (must be changed upon first login) |

---

## 4. Direct EC2 Deployment Guide (Ubuntu 24.04 LTS)

### Step 1: Install Node.js 24 LTS, Native Build Tools & SQLite CLI
Connect to your EC2 instance via SSH:
```bash
ssh -i "TechHorizon.pem" ubuntu@13.235.2.205
```

Install prerequisites:
```bash
# Update package lists
sudo apt update

# Install C++ compiler tools required for better-sqlite3 and bcrypt native compilation
sudo apt install -y curl build-essential python3 sqlite3

# Install Node.js 24 LTS via official NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Verify versions
node -v   # Expected: v24.x.x
npm -v    # Expected: 10.x.x or 11.x.x
sqlite3 --version
```

### Step 2: Create Dedicated Service User & Directories
Run all application services under a dedicated non-login service user (`cmdctr`):
```bash
# Create system user without login shell
sudo useradd --system --no-create-home --shell /usr/sbin/nologin cmdctr

# Create application directory
sudo mkdir -p /opt/command-centre

# Create persistent database directory
sudo mkdir -p /var/data/command-centre

# Create application logs directory
sudo mkdir -p /var/log/command-centre

# Grant permissions to cmdctr
sudo chown -R cmdctr:cmdctr /opt/command-centre
sudo chown -R cmdctr:cmdctr /var/data/command-centre
sudo chown -R cmdctr:cmdctr /var/log/command-centre
sudo chmod 750 /var/data/command-centre
```

### Step 3: Deploy Application Code
Clone the repository or transfer the files into `/opt/command-centre`:
```bash
# Change to application directory
cd /opt/command-centre

# (Option A) Clone from GitHub:
# git clone <YOUR_GITHUB_REPO_URL> .

# (Option B) If transferring files directly from admin workstation via SCP:
# scp -i "TechHorizon.pem" -r command-centre/* ubuntu@13.235.2.205:/tmp/command-centre/
# sudo cp -r /tmp/command-centre/* /opt/command-centre/

# Install dependencies (compiles native better-sqlite3 and bcrypt on Ubuntu 24.04)
sudo -u cmdctr npm install --production

# Create production .env file
sudo -u cmdctr cp .env.example .env

# Generate a strong 64-character random session secret and write to .env
SESSION_SECRET_GEN=$(openssl rand -hex 32)
sudo -u cmdctr sed -i "s/replace_with_a_long_random_64_character_hex_secret/$SESSION_SECRET_GEN/" .env
```

### Step 4: Bootstrap Initial Administrator Account
Run the database seeder to create the SQLite database schema and the initial administrator account:
```bash
sudo -u cmdctr npm run seed
```
*Note: This creates the database tables (`users`, `sessions`, `audit_log`) and provisions the `admin` account with `must_change_password = 1`.*

### Step 5: Configure Systemd Service
Create the systemd service unit:
```bash
sudo tee /etc/systemd/system/command-centre.service > /dev/null << 'EOF'
[Unit]
Description=AWS Field Presales Command Centre (Node.js)
After=network.target

[Service]
Type=simple
User=cmdctr
Group=cmdctr
WorkingDirectory=/opt/command-centre
EnvironmentFile=/opt/command-centre/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/command-centre/app.log
StandardError=append:/var/log/command-centre/error.log

# Security Sandboxing
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/data/command-centre /var/log/command-centre

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable command-centre
sudo systemctl start command-centre
sudo systemctl status command-centre
```

---

## 5. Self-Signed SSL Certificate for IP SAN (13.235.2.205)

Generate a self-signed certificate with IP Subject Alternative Name (`IP:13.235.2.205`):

```bash
# Create directory for certificates
sudo mkdir -p /etc/ssl/command-centre
sudo chmod 700 /etc/ssl/command-centre

# Generate certificate with IP SAN
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/command-centre/server.key \
  -out /etc/ssl/command-centre/server.crt \
  -subj "/C=IN/ST=Tamil Nadu/L=Chennai/O=Redington Limited/OU=AWS Field Presales/CN=13.235.2.205" \
  -addext "subjectAltName=IP:13.235.2.205" \
  -addext "extendedKeyUsage=serverAuth"

# Secure private key permissions
sudo chmod 600 /etc/ssl/command-centre/server.key
sudo chmod 644 /etc/ssl/command-centre/server.crt
```

---

## 6. Nginx HTTPS Configuration (Port 443 Only)

Create an independent Nginx server block that leaves the existing AWS Tech Horizon on port 80 HTTP completely untouched. Do NOT add any global HTTP-to-HTTPS redirect.

Create `/etc/nginx/sites-available/command-centre`:
```nginx
# ==============================================================================
# AWS Field Presales Command Centre — HTTPS Reverse Proxy (Port 443 Only)
# Note: Existing Port 80 HTTP site (AWS Tech Horizon) remains untouched.
# ==============================================================================

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name 13.235.2.205;

    # SSL Certificates (Self-signed with IP SAN: 13.235.2.205)
    ssl_certificate /etc/ssl/command-centre/server.crt;
    ssl_certificate_key /etc/ssl/command-centre/server.key;

    # TLS Protocols & Ciphers
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security Headers
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Reverse Proxy exclusively to Command Centre Express Backend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
```

Enable the configuration and reload Nginx:
```bash
sudo ln -sf /etc/nginx/sites-available/command-centre /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. Administrator Operational Guide

### Adding Team Members & Credential Dispatch
1. Open `https://13.235.2.205/login` and log in with your administrator account.
2. Navigate to **Admin Console** in the top navigation bar.
3. Click **+ Add Presales User**.
4. Enter the user's details:
   * **Full Name**: e.g., *Jane Doe*
   * **Username**: e.g., *jdoe*
   * **Corporate Email**: e.g., *jdoe@redington.com*
   * **Role**: `User` or `Admin`
   * **Designation & Location**: e.g., *Senior Cloud Architect*, *Mumbai*
   * **Application Access Entitlements**: Check *AWS Tech Horizon* and/or *Monthly Report Generator*.
5. Click **Create User & Generate Credentials**:
   * The system automatically generates a cryptographically random 16-character temporary password meeting all complexity criteria.
   * A prompt appears to download an in-memory generated credential file: `credentials-jdoe-<timestamp>.txt`.
   * Securely share this file or the temporary password with the team member.

### First-Time Login & Mandatory Password Change
* When the new user logs in for the first time, the system detects `must_change_password = 1`.
* All application routes are locked until the user sets a new personal password on the **My Profile & Security** page.
* Upon successfully updating their password, full access to their authorized applications is granted immediately.

### Password Reset Flow
* If a team member forgets their password, an Administrator can click **Reset Password** on the user's row in the Admin Console.
* The system invalidates all existing active sessions for that user, generates a fresh 16-character temporary password, resets `must_change_password = 1`, and provides a downloadable `.txt` credential file for the admin to distribute.

### Database Backups (Zero Downtime)
Because SQLite runs in WAL mode, backups can be taken without locking read operations:
```bash
# Take hot backup using SQLite CLI
sudo -u cmdctr sqlite3 /var/data/command-centre/command_centre.db ".backup /var/data/command-centre/backup_$(date +%Y%m%d_%H%M%S).db"
```

# Parent Dashboard - AI Teacher

Web app for parents to view their child's English learning conversation history with the AI Teacher.

## Architecture

- **Backend:** Node.js + Express + EJS
- **Database:** Reads directly from existing `xiaozhi_esp32_server` MySQL (read-only)
- **Auth:** Session-based login using `sys_user` credentials (same as web console)
- **Deployment:** Docker container on same network as xiaozhi server stack

## Deployment Steps

### 1. Copy files to server

```bash
scp -r parent-dashboard/ picopiece@192.168.1.48:/opt/parent-dashboard/
```

### 2. Create read-only MySQL user

```bash
ssh picopiece@192.168.1.48
cat /opt/parent-dashboard/setup-db-user.sql | docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456
```

### 3. Find the Docker network name

```bash
docker network ls | grep xiaozhi
```

If the network name differs from `xiaozhi-esp32-server_default`, edit `docker-compose.yml` accordingly.

### 4. Build and start

```bash
cd /opt/parent-dashboard
docker compose up -d --build
```

### 5. Verify

Open `http://192.168.1.48:8005` in a browser. Log in with your xiaozhi web console credentials.

### 6. Add Cloudflare Tunnel route (optional)

Add a public hostname in Cloudflare Zero Trust dashboard:
- **Subdomain:** e.g. `parent.yourdomain.com`
- **Service:** `http://localhost:8005`

## Features

- Login with existing parent account (from xiaozhi web console)
- View all devices linked to the account
- Browse chat sessions per device
- Read full conversation history with chat bubble UI
- Mobile-friendly responsive design

## Database Tables Used (Read-Only)

| Table | Purpose |
|-------|---------|
| `sys_user` | Authentication (username/password) |
| `ai_device` | Devices linked to user via `user_id` |
| `ai_agent_chat_history` | Chat messages (session_id, chat_type 1=user/2=AI, content) |
| `ai_agent` | Agent info (name) |

## Troubleshooting

**Cannot connect to database:**
- Ensure the container is on the same Docker network as `xiaozhi-esp32-server-db`
- Check: `docker exec parent-dashboard ping xiaozhi-esp32-server-db`

**Login fails:**
- Verify the `parent_reader` MySQL user exists and has SELECT grants
- Check password hash format: the server may use bcrypt or SHA-256

**No chat history shown:**
- Ensure the agent has Memory configured (not "No memory")
- Check `ai_agent_chat_history` table has data for the device's MAC address

# LINYA local server and Firestore sync

The school PC is the LAN server. It serves the built frontend, queue API, and Socket.IO updates on port `5000`. Local queue data is saved in `data/queue-data.json`; Firestore is synchronized as an online copy and recovery source.

## Deploying on Render

The repository includes a `render.yaml` Blueprint. In Render, create a new Blueprint from this repository and leave the root directory unset. The Blueprint sets `TZ=Asia/Manila` so office hours, ticket dates, and closing rollover use Philippine local time. If configuring a Web Service manually, add `TZ` with value `Asia/Manila` in its Environment settings. Add `FIREBASE_KEY` there with the complete service-account JSON as the value; mark it secret. Never commit or paste the key into source files.

The Blueprint builds the frontend and server, starts the server, and uses `/api/health` for health checks. After deployment, confirm that `cloudSync.enabled` is `true` and `cloudSync.lastSuccess` has a timestamp at `https://<your-service>.onrender.com/api/health`.

The free Render filesystem is ephemeral. Firestore is required to recover queue state after a service restart; for durable local-file storage, attach a persistent disk mounted at `/var/data` and set `DATA_DIR` to `/var/data` in the service environment. Render also cannot serve campus devices when their internet connection is down or directly access a printer attached to the school PC. Use the school-PC LAN setup below if offline campus service and local printing are required.

## Initial setup on the school PC

1. Install a supported Node.js LTS release.
2. Enable Firestore in the Firebase project and create a service account with permission to read and write Firestore.
3. Place its service-account JSON in `linya-server/firebase-key.json`. This file is ignored by Git; do not commit or share it. The server also accepts the JSON through the `FIREBASE_KEY` environment variable.
4. With internet available, build the frontend and start the server from the repository root:

   ```powershell
   Set-Location .\frontend
   npm ci
   npm run build

   Set-Location ..\linya-server
   npm ci
   npm start
   ```

5. Check `http://localhost:5000/api/health`. Confirm `cloudSync.enabled` is `true`, then wait for `cloudSync.lastSuccess` to show a timestamp before relying on an existing Firestore dataset.
6. Give the PC a reserved LAN IP address. Allow inbound TCP port `5000` on the **Private** Windows network profile, then open `http://<school-PC-LAN-IP>:5000` on devices connected to the school LAN.

Keep the PC powered on and the server running during service hours. All office devices should use this LAN URL so one server assigns ticket numbers and saves changes locally. When the internet is unavailable, the LAN server continues to operate; it retries Firestore reconciliation every 30 seconds after connectivity returns. Firestore synchronization status and failures are available at `/api/health`.

The server merges tickets by their `updatedAt` timestamp, uses the larger counter value for each office and date, and keeps office-state changes timestamped. Retain regular backups of `data/queue-data.json`; Firestore sync is not a substitute for backups.

## HTTPS for phone location

Phone browsers require a secure context for location access. For local HTTPS, configure a certificate trusted by the devices and set both `LOCAL_TLS_CERT_PATH` and `LOCAL_TLS_KEY_PATH` in the server's environment before starting it. The certificate and private key should be stored outside the repository. Without a trusted certificate, phone ticket requests that require location may not work from a LAN HTTP address.

## Git and runtime data

The queue file and print jobs are runtime data and are now ignored for future additions. Existing tracked copies must be removed from Git tracking before publishing; removing them from tracking should preserve the local files. Never publish queue or print-job data.

# VitalScan

VitalScan is a browser-based wellness scanner for desktop and mobile. It uses the camera locally to estimate pulse from fingertip color changes, then lets you save readings with optional manual values for SpO2, temperature, and blood pressure.

Camera estimates can be wrong. Do not use this app for emergencies, diagnosis, or medication decisions.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000` on your computer.

## Environment

Create `.env` from `.env.example` and put your test key there:

```bash
VITALSCAN_API_KEY=your_test_key_here
```

The key stays on the server and is not committed to GitHub.

## Test On Phone

Mobile browsers generally require HTTPS before allowing camera access. Deploy the app to an HTTPS host, or expose your local server through an HTTPS tunnel, then open that HTTPS URL on your phone.

## Commit

Commit the app source and lockfile:

```bash
git add .gitignore .env.example README.md index.html package.json package-lock.json renderer.js server.js styles.css
git commit -m "Build VitalScan web app"
```

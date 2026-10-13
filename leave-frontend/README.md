# Leave Management Frontend

The user interface for the leave management system, built with Next.js and React. It has three screens: My requests, New request and Approvals. All data comes from the API in `leave-api`.

## Requirements

- Node.js and npm
- The API running (see the main `README.md` in the project root). The API uses port 3000, so this frontend runs on port 3001.

## Run it

From the `leave-frontend` folder:

```bash
npm install
```

Copy `.env.example` to `.env.local`. It holds the address of the API:

```powershell
Copy-Item .env.example .env.local
```

On macOS or Linux: `cp .env.example .env.local`

The default (`http://localhost:3000`) matches the API's default port. `.env.local` is local configuration and is not committed.

Start the frontend:

```bash
npm run dev -- -p 3001
```

Open `http://localhost:3001`. There is no login yet, so the menu at the top right switches between people while testing.

## Scripts

```bash
npm run dev -- -p 3001   # development server on port 3001
npm run lint             # check the code for mistakes
npm run build            # production build
npm run start            # run the production build
```

## Notes

- Everything goes through `lib/api.ts`, the only file that talks to the API.
- Dates are shown as `dd-MMM-yy`. Timestamps are shown in the `Africa/Cairo` timezone.
- If the API is not running, each screen shows a clear message instead of data.
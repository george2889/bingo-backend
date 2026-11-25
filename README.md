# Loop Backend

A Node.js API for the Loop recycling frontend.

## Features

- Persistent SQLite accounts and bearer sessions
- Location and recycling-rule lookup
- Item search
- Profile updates
- Image scan upload endpoint
- Teachable Machine class-to-item mapping for the published image model
- Password hashing with Node.js `scrypt`

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs at `http://localhost:3001` by default.
Cross-origin requests are enabled for `http://localhost:5173` and
`https://bingotesting238.netlify.app` by default. Override `CORS_ORIGIN` with a
comma-separated list of exact origins if needed.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/locations` | Supported locations |
| GET | `/api/items?search=` | Item catalog |
| POST | `/api/lookup` | Resolve a sorting rule |
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Get the signed-in account |
| PATCH | `/api/profile` | Update account and location |
| POST | `/api/scans` | Upload an item photo and resolve a rule |
| GET | `/api/scanner/config` | Teachable Machine model URL and supported labels |

Send authenticated requests with `Authorization: Bearer <token>`.

The scanner model runs in the browser. Load the `modelUrl` from
`GET /api/scanner/config`, pass the top prediction's `className` and `probability`
to `POST /api/scans` along with the user's `city` and optional `homeType`. The
current model labels map to these catalog items: `aerosol_can`, `aluminum_can`,
`bread_pasta`, and `cell_phone`. Unsupported labels are rejected rather than
being treated as another item. A photo may optionally be included as multipart
field `photo`.

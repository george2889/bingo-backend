import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db.js";
import { createToken, hashPassword, verifyPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3001);
const corsOrigin = process.env.CORS_ORIGIN ||
  "http://localhost:5173,https://bingotesting238.netlify.app";
const teachableMachineModelUrl = process.env.TEACHABLE_MACHINE_MODEL_URL ||
  "https://teachablemachine.withgoogle.com/models/Ih-oYuk1i/";
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(rootDir, process.env.DATABASE_PATH)
  : path.resolve(rootDir, "data/loop.sqlite");

mkdirSync(path.dirname(databasePath), { recursive: true });
mkdirSync(path.resolve(rootDir, "uploads"), { recursive: true });

const db = createDatabase(databasePath);
const sortingData = JSON.parse(
  await readFile(path.resolve(rootDir, "src/data/sortingData.json"), "utf8"),
);

const app = express();
app.use(helmet());
app.use(cors({
  origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((value) => value.trim()),
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  dest: path.resolve(rootDir, "uploads"),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
    } else {
      callback(new Error("Only image uploads are allowed"), false);
    }
  },
});

function locationForCity(city) {
  const cityName = String(city || "").split(",")[0].trim().toLowerCase();
  return sortingData.locations.find((location) =>
    location.city_or_county.split(" (")[0].trim().toLowerCase() === cityName,
  );
}

function publicUser(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    username: row.username,
    email: row.email,
    city: row.city,
    homeType: row.home_type,
  };
}

function authUser(req, res, next) {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required" });

  const session = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Invalid or expired session" });

  req.user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  if (!req.user) return res.status(401).json({ error: "Invalid or expired session" });
  next();
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8 && /\d/.test(password);
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "loop-backend" });
});

app.get("/api/locations", (_req, res) => {
  const locations = sortingData.locations.map((location) => ({
    ...location,
    city: `${location.city_or_county.split(" (")[0].trim()}, California`,
  }));
  res.json({ locations });
});

app.get("/api/items", (req, res) => {
  const search = String(req.query.search || "").trim().toLowerCase();
  const items = sortingData.items
    .filter((item) => !search ||
      `${item.example} ${item.material} ${item.item_class}`.toLowerCase().includes(search))
    .slice()
    .sort((a, b) => a.example.localeCompare(b.example));
  res.json({ items });
});

app.get("/api/scanner/config", (_req, res) => {
  res.json({
    modelUrl: teachableMachineModelUrl.endsWith("/")
      ? teachableMachineModelUrl
      : `${teachableMachineModelUrl}/`,
    classLabels: ["aerosol_can", "aluminum_can", "bread_pasta", "cell_phone"],
  });
});

app.post("/api/lookup", (req, res) => {
  const itemClass = String(req.body.itemClass || req.body.item_class || "").trim();
  const city = String(req.body.city || "");
  const homeType = String(req.body.homeType || req.body.home_type || "");
  const location = locationForCity(city);

  if (!location) return res.status(404).json({ error: "Unknown location" });
  if (location.location_id === "berkeley_ca" && !homeType) {
    return res.json({ location, rule: null, requiresHomeType: true });
  }

  const rule = sortingData.rules.find((entry) =>
    entry.ruleset_id === location.ruleset_id && entry.item_class === itemClass,
  );
  if (!rule) return res.status(404).json({ error: "No sorting rule found" });

  res.json({
    location,
    rule,
    binLabel: getBinLabel(rule.bin),
    binSummary: getBinSummary(rule.bin),
  });
});

app.post("/api/auth/register", (req, res) => {
  const firstName = String(req.body.firstName || req.body.first_name || "").trim();
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const city = String(req.body.city || "Lafayette, California").trim();
  const homeType = String(req.body.homeType || req.body.home_type || "").trim();

  if (!firstName || !username || !email || !validatePassword(password)) {
    return res.status(400).json({ error: "Name, username, email, and a valid password are required" });
  }
  if (!locationForCity(city)) return res.status(400).json({ error: "Unknown location" });

  const { salt, hash } = hashPassword(password);
  try {
    const result = db.prepare(`
      INSERT INTO users (first_name, username, email, password_hash, password_salt, city, home_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(firstName, username, email, hash, salt, city, homeType);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(result.lastInsertRowid));
    const token = createToken();
    db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "Username or email is already in use" });
    }
    throw error;
  }
});

app.post("/api/auth/login", (req, res) => {
  const id = String(req.body.id || req.body.identifier || "").trim();
  const password = String(req.body.password || "");
  if (!id || !password) return res.status(400).json({ error: "Identifier and password are required" });

  const user = db.prepare(
    "SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE",
  ).get(id, id);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: "Email, username, or password is incorrect" });
  }

  const token = createToken();
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
  res.json({ token, user: publicUser(user) });
});

app.post("/api/auth/logout", authUser, (req, res) => {
  const authorization = req.get("authorization") || "";
  const token = authorization.slice(7);
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.status(204).end();
});

app.get("/api/auth/me", authUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch("/api/profile", authUser, (req, res) => {
  const firstName = String(req.body.firstName || req.body.first_name || req.user.first_name).trim();
  const username = String(req.body.username || req.user.username).trim();
  const email = String(req.body.email || req.user.email).trim();
  const city = String(req.body.city || req.user.city).trim();
  const homeType = String(
    req.body.homeType || req.body.home_type || req.user.home_type,
  ).trim();

  if (!firstName || !username || !email) {
    return res.status(400).json({ error: "Name, username, and email are required" });
  }
  if (!locationForCity(city)) return res.status(400).json({ error: "Unknown location" });

  try {
    db.prepare(`
      UPDATE users
      SET first_name = ?, username = ?, email = ?, city = ?, home_type = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(firstName, username, email, city, homeType, req.user.id);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "Username or email is already in use" });
    }
    throw error;
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: publicUser(user) });
});

const modelLabelExamples = new Map([
  ["aerosol_can", "Aerosol can"],
  ["aluminum_can", "Aluminum can"],
  ["bread_pasta", "Bread and pasta"],
  ["cell_phone", "Cell phone"],
]);

app.post("/api/scans", upload.single("photo"), (req, res) => {
  const city = String(req.body.city || req.query.city || "Lafayette, California");
  const homeType = String(req.body.homeType || req.body.home_type || "");
  const prediction = req.body.prediction && typeof req.body.prediction === "object"
    ? req.body.prediction
    : null;
  const className = String(
    req.body.className || prediction?.className || req.body.prediction || "",
  ).trim();
  const rawProbability = req.body.probability ?? prediction?.probability;
  const probability = rawProbability === undefined ? null : Number(rawProbability);
  if (!className) {
    return res.status(400).json({ error: "A model prediction className is required" });
  }
  if (rawProbability !== undefined &&
      (!Number.isFinite(probability) || probability < 0 || probability > 1)) {
    return res.status(400).json({ error: "Prediction probability must be between 0 and 1" });
  }

  const itemExample = modelLabelExamples.get(className);
  if (!itemExample) {
    return res.status(422).json({ error: "The model prediction is not a supported class" });
  }

  const location = locationForCity(city);
  if (!location) return res.status(404).json({ error: "Unknown location" });
  if (location.location_id === "berkeley_ca" && !homeType) {
    return res.json({ location, item: null, rule: null, requiresHomeType: true });
  }

  const item = sortingData.items.find((entry) => entry.example === itemExample);
  const rule = sortingData.rules.find((entry) =>
    entry.ruleset_id === location.ruleset_id && entry.item_class === item.item_class,
  );

  res.status(201).json({
    item,
    prediction: { className, probability },
    location,
    rule,
    binLabel: rule ? getBinLabel(rule.bin) : null,
    binSummary: rule ? getBinSummary(rule.bin) : null,
    photo: req.file ? {
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
    } : null,
  });
});

function getBinLabel(bin) {
  return ({
    recycling: "Recycling",
    trash: "Landfill",
    compost: "Compost / organics",
    special_disposal: "Special disposal",
    needs_verification: "Needs local verification",
  })[bin] || "Check local rules";
}

function getBinSummary(bin) {
  return ({
    recycling: "Place in your recycling cart.",
    trash: "Place in your landfill cart.",
    compost: "Place in your organics cart.",
    special_disposal: "Use an approved special collection or drop-off.",
    needs_verification: "The available local guidance does not confirm this item’s cart destination. Check the linked local guide before sorting.",
  })[bin] || "Check your local guide before sorting.";
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({ error: error.message || "Internal server error" });
});

export { app, db };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Loop backend listening on http://localhost:${port}`);
  });
}

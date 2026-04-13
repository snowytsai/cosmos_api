import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";

import { PLANETS } from "./utils/planetMap.js";
import { fetchPlanetVector } from "./services/horizonsClient.js";
import { parseVectorRaw } from "./services/ephemerisParser.js";
import { cleanOldFiles } from "./services/cacheCleaner.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const APP_API_KEY = process.env.APP_API_KEY;

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60
});

app.use("/api", limiter);

function checkApiKey(req, res, next) {
  const key = req.headers["x-api-key"];

  if (!key || key !== APP_API_KEY) {
    return res.status(403).json({
      error: "API key invalid"
    });
  }

  next();
}

app.use("/api", checkApiKey);

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "cosmos_api" });
});


// ⭐ 工具：日期
function getDateStr(dateParam) {
  if (dateParam) return dateParam;
  return new Date().toISOString().slice(0, 10);
}

// ⭐ 快取路徑
function getCachePath(dateStr) {
  return path.resolve(`data/daily/${dateStr}.json`);
}


// 🔥 主API：daily（給EZtarot用）
app.get("/api/ephemeris/daily", async (req, res) => {
  try {
    const dateStr = getDateStr(req.query.date);
    const filePath = getCachePath(dateStr);

    // ✅ 1️⃣ 有cache → 直接回
    if (fs.existsSync(filePath)) {
      console.log("📦 使用快取:", dateStr);

      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      return res.json({
        ok: true,
        source: "cache",
        data
      });
    }

    console.log("🌐 無快取，開始抓JPL:", dateStr);

    // ✅ 2️⃣ 沒cache → 抓JPL
    const results = [];

    for (const planet of PLANETS) {
    // 今天
    const rawToday = await fetchPlanetVector(planet.command);
    const parsedToday = parseVectorRaw(rawToday);

    // 明天（拿來判斷逆行）
    const rawTomorrow = await fetchPlanetVector(planet.command, 1);
    const parsedTomorrow = parseVectorRaw(rawTomorrow);

    const isRetrograde = parsedTomorrow.longitude < parsedToday.longitude;

    results.push({
      key: planet.key,
      name: planet.name,
      command: planet.command,
      longitude: parsedToday.longitude,
      sign: parsedToday.sign,
      signDegree: parsedToday.signDegree,
      retrograde: isRetrograde
    });
  }

    const output = {
      date: dateStr,
      source: "JPL Horizons",
      planets: results
    };

    // ✅ 3️⃣ 存檔
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(output, null, 2));

    console.log("💾 已存檔:", filePath);

    res.json({
      ok: true,
      source: "generated",
      data: output
    });

  } catch (error) {
    console.error("daily ephemeris error =", error);

    res.status(500).json({
      error: "daily ephemeris failed",
      detail: error?.message || "unknown error"
    });
  }
});


// ⚙️ 測試用（保留）
app.get("/api/ephemeris/planets", async (req, res) => {
  try {
    const target = PLANETS.find(p => p.key === "sun");

    const raw = await fetchPlanetVector(target.command);
    const parsed = parseVectorRaw(raw);

    res.json({
      ok: true,
      planet: {
        key: target.key,
        name: target.name,
        raw,
        parsed
      }
    });

  } catch (error) {
    console.error("ephemeris planets error =", error);

    res.status(500).json({
      error: "ephemeris planets failed",
      detail: error?.message || "unknown error"
    });
  }
});


app.listen(process.env.PORT || 3001, () => {
  console.log(`cosmos_api running on port ${process.env.PORT || 3001}`);

  // ⭐ 啟動時清理3年前資料
  cleanOldFiles();
});
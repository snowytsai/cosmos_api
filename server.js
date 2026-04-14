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
import { calculateAspects } from "./services/aspectCalculator.js";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

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

// =========================
// 文字工具
// =========================

function formatPlanetLine(p) {
  const retroText = p.retrograde ? "逆行" : "順行";
  return `${p.name}：${p.sign} ${Math.round(p.signDegree)}°，${retroText}`;
}

function formatAspectLine(a) {
  const p1Name = a.p1Name || a.planet1Name || a.planet1 || a.p1 || "";
  const p2Name = a.p2Name || a.planet2Name || a.planet2 || a.p2 || "";
  const angle = Number(a.angle ?? a.orb ?? 0).toFixed(2);
  const label = a.label || a.type || "相位";
  return `${p1Name} ${label} ${p2Name}（${angle}°）`;
}

function buildFullAstrologyText(ephemeris) {
  const planets = ephemeris?.planets || [];
  const aspects = ephemeris?.aspects || [];

  const majorPlanetKeys = [
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn"
  ];

  const majorPlanets = planets.filter((p) => majorPlanetKeys.includes(p.key));
  const majorAspects = aspects.slice(0, 12);

  const planetText = majorPlanets.map(formatPlanetLine).join("\n");
  const aspectText = majorAspects.map(formatAspectLine).join("\n");

  return `今日星象：\n\n${planetText}\n\n今日主要相位：\n${aspectText}`.trim();
}

function buildDisplaySummary(ephemeris) {
  const planets = ephemeris?.planets || [];
  const aspects = ephemeris?.aspects || [];

  const majorPlanetKeys = [
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn"
  ];

  const majorPlanets = planets.filter((p) => majorPlanetKeys.includes(p.key));

  const planetLines = majorPlanets.map((p) => {
    const retroText = p.retrograde ? "（逆行）" : "";
    return `${p.name}在${p.sign}${retroText}`;
  });

  const aspectLines = aspects.slice(0, 5).map((a) => {
    const p1Name = a.p1Name || a.planet1Name || a.planet1 || a.p1 || "";
    const p2Name = a.p2Name || a.planet2Name || a.planet2 || a.p2 || "";
    const label = a.label || a.type || "相位";
    return `${p1Name}${label}${p2Name}`;
  });

  return [...planetLines, "", ...aspectLines].join("\n");
}

function buildGptContext(ephemeris) {
  return buildFullAstrologyText(ephemeris);
}

// 🔥 主API：daily（給 EZtarot 用）
app.get("/api/ephemeris/daily", async (req, res) => {
  try {
    const dateStr = getDateStr(req.query.date);
    const filePath = getCachePath(dateStr);

    if (fs.existsSync(filePath)) {
      console.log("📦 使用快取:", dateStr);

      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      return res.json({
        ok: true,
        source: "cache",
        data
      });
    }

    console.log("🌐 無快取，開始抓 JPL:", dateStr);

    const results = [];

    for (const planet of PLANETS) {
      const rawToday = await fetchPlanetVector(planet.command, 0);
      const parsedToday = parseVectorRaw(rawToday);

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

    const aspects = calculateAspects(results);

    const output = {
      date: dateStr,
      source: "JPL Horizons",
      planets: results,
      aspects
    };

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

// 🔮 給 GPT 用的完整 prompt
app.get("/api/ephemeris/summary", async (req, res) => {
  try {
    const dateStr = getDateStr(req.query.date);
    const filePath = getCachePath(dateStr);

    if (!fs.existsSync(filePath)) {
      return res.status(400).json({
        error: "請先呼叫 /api/ephemeris/daily 產生資料"
      });
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const prompt = buildGptContext(data);

    res.json({
      ok: true,
      date: dateStr,
      prompt
    });
  } catch (error) {
    console.error("summary error =", error);

    res.status(500).json({
      error: "summary failed",
      detail: error?.message || "unknown error"
    });
  }
});

// ✨ 給 App 顯示用的精簡摘要
app.get("/api/ephemeris/display-summary", async (req, res) => {
  try {
    const dateStr = getDateStr(req.query.date);
    const filePath = getCachePath(dateStr);

    if (!fs.existsSync(filePath)) {
      return res.status(400).json({
        error: "請先呼叫 /api/ephemeris/daily 產生資料"
      });
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const summary = buildDisplaySummary(data);

    res.json({
      ok: true,
      date: dateStr,
      summary
    });
  } catch (error) {
    console.error("display summary error =", error);

    res.status(500).json({
      error: "display summary failed",
      detail: error?.message || "unknown error"
    });
  }
});

// ⚙️ 測試用（保留）
app.get("/api/ephemeris/planets", async (req, res) => {
  try {
    const target = PLANETS.find((p) => p.key === "sun");

    const raw = await fetchPlanetVector(target.command, 0);
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
  cleanOldFiles();
});
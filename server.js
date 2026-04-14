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
// 顯示層文案資料
// =========================

const sunSignMessages = {
  牡羊座: "今天行動力強，適合主動出擊，但要避免過於急躁。",
  金牛座: "今天適合穩定推進，重視節奏與實際成果。",
  雙子座: "今天思緒活躍，適合溝通、學習與整理資訊。",
  巨蟹座: "今天更在意情感與安全感，適合照顧自己與身邊的人。",
  獅子座: "今天適合展現自己，自信會帶來推進力。",
  處女座: "今天適合整理細節，把事情一步一步做好。",
  天秤座: "今天適合協調關係與溝通，重視平衡感。",
  天蠍座: "今天適合深入思考，專注處理真正重要的事。",
  射手座: "今天適合拓展視野，往更開闊的方向前進。",
  摩羯座: "今天適合務實推進，把焦點放在責任與成果。",
  水瓶座: "今天適合用新角度思考，跳脫原本的做法。",
  雙魚座: "今天直覺敏銳，適合傾聽內在感受與靈感。"
};

const moonSignMessages = {
  牡羊座: "情緒反應偏快，容易直接表達感受。",
  金牛座: "情緒需要穩定感，適合放慢步調。",
  雙子座: "情緒和思緒連動較多，容易分心。",
  巨蟹座: "情緒細膩，容易受環境與熟悉的人影響。",
  獅子座: "情緒表達較明顯，也更希望被理解。",
  處女座: "情緒上比較在意細節，容易想太多。",
  天秤座: "情緒面重視互動品質，容易受關係影響。",
  天蠍座: "情緒較深，很多感受不一定會直接說出口。",
  射手座: "情緒需要空間，適合轉換環境或節奏。",
  摩羯座: "情緒較收斂，容易先處理責任再照顧自己。",
  水瓶座: "情緒和理性拉扯，會想先保持距離觀察。",
  雙魚座: "情緒感受較敏銳，容易受氣氛與他人影響。"
};

const mercurySignMessages = {
  牡羊座: "想法與表達偏直接，溝通節奏會比較快。",
  金牛座: "思考偏務實，適合處理實際可落地的事。",
  雙子座: "腦袋轉得快，適合交流、學習與整理訊息。",
  巨蟹座: "說話較受情緒影響，溝通時會帶入感受。",
  獅子座: "表達方式較有存在感，也更想說出自己的觀點。",
  處女座: "適合整理細節、分析問題與修正流程。",
  天秤座: "思考會顧及他人立場，適合協調與討論。",
  天蠍座: "觀察力敏銳，容易看見事情背後的重點。",
  射手座: "想法偏開放，適合討論方向與未來規劃。",
  摩羯座: "思考偏理性務實，適合談責任與執行。",
  水瓶座: "靈感較跳躍，適合從不同角度切入問題。",
  雙魚座: "直覺型思考較強，但也要留意資訊模糊。"
};

const venusSignMessages = {
  牡羊座: "人際與情感互動偏直接，喜歡乾脆明快的節奏。",
  金牛座: "重視舒適與穩定，適合經營實在的關係感。",
  雙子座: "互動偏輕鬆活潑，聊天交流會特別重要。",
  巨蟹座: "情感上更重視被照顧與安全感。",
  獅子座: "在人際互動中希望被重視，也願意主動釋出好意。",
  處女座: "會更在意細節與實際表現，容易默默付出。",
  天秤座: "互動氣氛較柔和，適合協調與建立和諧感。",
  天蠍座: "情感感受較深，對距離與信任會更敏感。",
  射手座: "喜歡自在與開闊的互動方式，不喜歡太拘束。",
  摩羯座: "情感表達偏內斂，但重視長久與穩定。",
  水瓶座: "互動上需要空間，喜歡自然不黏膩的關係感。",
  雙魚座: "感受力強，容易被溫柔與共感打動。"
};

const marsSignMessages = {
  牡羊座: "執行力很強，做事容易一鼓作氣。",
  金牛座: "行動步調穩，適合持續推進長期目標。",
  雙子座: "做事節奏快，容易同時處理多件事。",
  巨蟹座: "行動常受情緒影響，適合先穩定感受再出手。",
  獅子座: "行動帶有主導性，適合正面表現與推進。",
  處女座: "適合細緻執行，把事情慢慢修到更完整。",
  天秤座: "行動前容易考慮平衡與他人想法。",
  天蠍座: "行動力集中且有穿透力，適合處理核心問題。",
  射手座: "行動偏向拓展與探索，適合打開新局。",
  摩羯座: "執行力務實，適合穩穩累積成果。",
  水瓶座: "行動方式偏創新，適合嘗試不同路徑。",
  雙魚座: "行動感受化，先確認方向會更有效率。"
};

const aspectMessages = {
  mercury_mars: "溝通節奏偏快，說話容易太直接，互動時要留意語氣。",
  mars_mercury: "溝通節奏偏快，說話容易太直接，互動時要留意語氣。",

  mars_neptune: "行動前建議先確認方向，避免一時衝動或判斷模糊。",
  neptune_mars: "行動前建議先確認方向，避免一時衝動或判斷模糊。",

  mercury_neptune: "資訊感受較模糊，溝通時要多確認彼此理解是否一致。",
  neptune_mercury: "資訊感受較模糊，溝通時要多確認彼此理解是否一致。",

  venus_jupiter: "人際氣氛偏柔和，適合釋出善意與建立好感。",
  jupiter_venus: "人際氣氛偏柔和，適合釋出善意與建立好感。",

  sun_mars: "今天的推進力較強，但也要留意不要太急。",
  mars_sun: "今天的推進力較強，但也要留意不要太急。",

  moon_saturn: "情緒上可能稍微收斂，適合先整理感受再回應。",
  saturn_moon: "情緒上可能稍微收斂，適合先整理感受再回應。",

  moon_jupiter: "情緒能量較放大，容易更有感，也更想分享。",
  jupiter_moon: "情緒能量較放大，容易更有感，也更想分享。",

  venus_saturn: "情感與關係會更重視界線、承諾與穩定性。",
  saturn_venus: "情感與關係會更重視界線、承諾與穩定性。",

  mercury_uranus: "想法跳得快，容易冒出突然的靈感或新觀點。",
  uranus_mercury: "想法跳得快，容易冒出突然的靈感或新觀點。",

  sun_neptune: "今天直覺感較強，但也要避免理想化。",
  neptune_sun: "今天直覺感較強，但也要避免理想化。",

  moon_venus: "情緒與人際互動較柔和，適合用溫和方式表達。",
  venus_moon: "情緒與人際互動較柔和，適合用溫和方式表達。",

  mars_saturn: "行動上需要多一點耐心，穩穩來反而更有效。",
  saturn_mars: "行動上需要多一點耐心，穩穩來反而更有效。",

  sun_jupiter: "整體能量較開展，適合往更大的方向思考。",
  jupiter_sun: "整體能量較開展，適合往更大的方向思考。",

  mercury_saturn: "思考偏嚴謹，適合整理規則、細節與重點。",
  saturn_mercury: "思考偏嚴謹，適合整理規則、細節與重點。"
};

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

function getAspectKey(a) {
  const p1 = a.p1 || a.planet1Key || a.planet1 || "";
  const p2 = a.p2 || a.planet2Key || a.planet2 || "";
  return `${p1}_${p2}`;
}

function buildDisplaySummary(ephemeris) {
  const planets = ephemeris?.planets || [];
  const aspects = ephemeris?.aspects || [];

  const getPlanet = (key) => planets.find((p) => p.key === key);

  const sun = getPlanet("sun");
  const moon = getPlanet("moon");
  const mercury = getPlanet("mercury");
  const venus = getPlanet("venus");
  const mars = getPlanet("mars");

  const lines = [];

  if (sun?.sign && sunSignMessages[sun.sign]) {
    lines.push(sunSignMessages[sun.sign]);
  }

  if (moon?.sign && moonSignMessages[moon.sign]) {
    lines.push(moonSignMessages[moon.sign]);
  }

  if (mercury?.sign && mercurySignMessages[mercury.sign]) {
    lines.push(mercurySignMessages[mercury.sign]);
  }

  if (venus?.sign && venusSignMessages[venus.sign]) {
    lines.push(venusSignMessages[venus.sign]);
  }

  if (mars?.sign && marsSignMessages[mars.sign]) {
    lines.push(marsSignMessages[mars.sign]);
  }

  for (const aspect of aspects) {
    const key = getAspectKey(aspect);
    const reversedKey = (() => {
      const p1 = aspect.p1 || aspect.planet1Key || aspect.planet1 || "";
      const p2 = aspect.p2 || aspect.planet2Key || aspect.planet2 || "";
      return `${p2}_${p1}`;
    })();

    if (aspectMessages[key]) {
      lines.push(aspectMessages[key]);
    } else if (aspectMessages[reversedKey]) {
      lines.push(aspectMessages[reversedKey]);
    }
  }

  const uniqueLines = [...new Set(lines)].filter(Boolean);

  if (uniqueLines.length === 0) {
    uniqueLines.push("今天適合穩住節奏，先整理重點再行動。");
  }

  return uniqueLines.slice(0, 5).join("\n");
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
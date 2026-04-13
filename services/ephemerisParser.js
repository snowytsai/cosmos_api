function normalizeDegrees(deg) {
  let value = deg % 360;
  if (value < 0) value += 360;
  return value;
}

function vectorToLongitude(x, y) {
  const radians = Math.atan2(y, x);
  const degrees = radians * 180 / Math.PI;
  return normalizeDegrees(degrees);
}

function getZodiacSign(longitude) {
  const signs = [
    "牡羊座",
    "金牛座",
    "雙子座",
    "巨蟹座",
    "獅子座",
    "處女座",
    "天秤座",
    "天蠍座",
    "射手座",
    "摩羯座",
    "水瓶座",
    "雙魚座"
  ];

  const index = Math.floor(longitude / 30);
  const degree = longitude % 30;

  return {
    sign: signs[index],
    signIndex: index,
    signDegree: degree
  };
}

export function parseVectorRaw(rawText) {
  if (!rawText) {
    throw new Error("rawText is empty");
  }

  const lines = rawText.split("\n").map(l => l.trim());

  const vectorLine = lines.find(
    line => line.includes("X =") && line.includes("Y =") && line.includes("Z =")
  );

  if (!vectorLine) {
    throw new Error("Vector line not found");
  }

  const xMatch = vectorLine.match(/X\s*=\s*([+\-0-9.Ee]+)/);
  const yMatch = vectorLine.match(/Y\s*=\s*([+\-0-9.Ee]+)/);
  const zMatch = vectorLine.match(/Z\s*=\s*([+\-0-9.Ee]+)/);

  if (!xMatch || !yMatch || !zMatch) {
    throw new Error("Failed to parse X/Y/Z");
  }

  const x = Number(xMatch[1]);
  const y = Number(yMatch[1]);
  const z = Number(zMatch[1]);

  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
    throw new Error("Parsed vector NaN");
  }

  const longitude = vectorToLongitude(x, y);
  const zodiac = getZodiacSign(longitude);

  return {
    x,
    y,
    z,
    longitude,
    sign: zodiac.sign,
    signIndex: zodiac.signIndex,
    signDegree: zodiac.signDegree
  };
}
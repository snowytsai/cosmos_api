function normalizeAngle(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function getAngleDiff(a, b) {
  let diff = Math.abs(a - b);
  return diff > 180 ? 360 - diff : diff;
}

const ASPECTS = [
  { name: "conjunction", label: "合相 ☌", degree: 0, orb: 8 },
  { name: "opposition", label: "對分 ☍", degree: 180, orb: 8 },
  { name: "trine", label: "三分 △", degree: 120, orb: 6 },
  { name: "square", label: "四分 □", degree: 90, orb: 6 },
  { name: "sextile", label: "六分 ⚹", degree: 60, orb: 4 },
];

export function calculateAspects(planets) {
  const results = [];

  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const p1 = planets[i];
      const p2 = planets[j];

      const lon1 = normalizeAngle(p1.longitude);
      const lon2 = normalizeAngle(p2.longitude);

      const diff = getAngleDiff(lon1, lon2);

      for (const asp of ASPECTS) {
        if (Math.abs(diff - asp.degree) <= asp.orb) {
          results.push({
            p1: p1.key,
            p1Name: p1.name,
            p2: p2.key,
            p2Name: p2.name,
            type: asp.name,
            label: asp.label,
            angle: diff.toFixed(2),
          });
        }
      }
    }
  }

  return results;
}
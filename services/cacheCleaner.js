import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("data/daily");

function getDateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  return match ? match[1] : null;
}

export function cleanOldFiles() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      return;
    }

    const files = fs.readdirSync(DATA_DIR);

    const now = new Date();
    const cutoff = new Date();
    cutoff.setFullYear(now.getFullYear() - 3);

    files.forEach(file => {
      const dateStr = getDateFromFilename(file);

      if (!dateStr) return;

      const fileDate = new Date(dateStr);

      if (fileDate < cutoff) {
        const filePath = path.join(DATA_DIR, file);

        fs.unlinkSync(filePath);

        console.log("🗑️ 刪除舊檔案:", file);
      }
    });

  } catch (error) {
    console.error("cleanOldFiles error =", error);
  }
}
import { MOCK_SPECTRUM_ROOT } from "../config/env.js";

export const recentRuns = [
  {
    runId: "R-24031",
    modelId: "M-ALD-77",
    status: "running",
    owner: "L. Chen",
    updated: "4 min ago"
  },
  {
    runId: "R-24029",
    modelId: "M-ALD-65",
    status: "paused",
    owner: "J. Wu",
    updated: "2 hr ago"
  },
  {
    runId: "R-24021",
    modelId: "M-ET-21",
    status: "succeeded",
    owner: "Y. Zhang",
    updated: "Yesterday"
  }
];

export const machineIds = ["Tool-A01", "Tool-B02", "Tool-C03"];

const recipeNames = ["Gate Stack", "Spacer Etch", "High-K"];
const lotIds = Array.from({ length: 24 }).map((_, index) => `LOT-${String(index + 1).padStart(3, "0")}`);

export const waferIds = Array.from({ length: 500 }).map(
  (_, index) => `WAFER-${String(index + 1).padStart(4, "0")}`
);

const formatLocalISO = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const spectrumObjects = (() => {
  const list = [];
  const totalDays = 180;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime());
  startDate.setDate(endDate.getDate() - (totalDays - 1));
  const spectrumRoot = MOCK_SPECTRUM_ROOT;
  let folderCounter = 1;
  const defaultSpectrumIds = Array.from({ length: 20 }).map(
    (_, index) => `SPEC_${String(index + 1).padStart(4, "0")}`
  );

  waferIds.forEach((waferId, index) => {
    const dayOffset = index % totalDays;
    const minutes = (index * 37) % 480 + 8 * 60;
    const baseDate = new Date(startDate.getTime() + dayOffset * 86400000);
    baseDate.setHours(0, 0, 0, 0);
    baseDate.setMinutes(minutes);

    const tool = machineIds[index % machineIds.length];
    const recipeName = recipeNames[index % recipeNames.length];
    const lotId = lotIds[index % lotIds.length];
    const spectrumFolder = `FOLDER-${String(folderCounter).padStart(4, "0")}`;
    folderCounter += 1;
    const waferFolderId = waferId.replace("-", "_");
    const spectrumIds = defaultSpectrumIds;
    const time = formatLocalISO(baseDate);
    const spectrumFolderPath = `${spectrumRoot}/${waferFolderId}/spectrum`;

    list.push({
      id: `OBJ-${String(index + 1).padStart(4, "0")}`,
      time,
      tool,
      recipeName,
      lotId,
      waferId,
      spectrumFolderId: spectrumFolder,
      spectrumFolder: spectrumFolderPath,
      spectrumIds,
      objectKey: spectrumFolderPath
    });

    if (index % 4 === 0) {
      const extraDayOffset = Math.min(dayOffset + 1, totalDays - 1);
      const extraDate = new Date(startDate.getTime() + extraDayOffset * 86400000);
      extraDate.setHours(0, 0, 0, 0);
      extraDate.setMinutes((minutes + 90) % 1440);
      const extraFolder = `FOLDER-${String(folderCounter).padStart(4, "0")}`;
      folderCounter += 1;
      const extraWaferFolderId = waferFolderId;
      const extraSpectrumIds = defaultSpectrumIds;
      const extraTime = formatLocalISO(extraDate);
      const extraFolderPath = `${spectrumRoot}/${extraWaferFolderId}/spectrum`;
      list.push({
        id: `OBJ-${String(list.length + 1).padStart(4, "0")}`,
        time: extraTime,
        tool,
        recipeName,
        lotId,
        waferId,
        spectrumFolderId: extraFolder,
        spectrumFolder: extraFolderPath,
        spectrumIds: extraSpectrumIds,
        objectKey: extraFolderPath
      });
    }
  });

  return list;
})();

export const spectrumIds = spectrumObjects.flatMap((row) => row.spectrumIds);

export const timeRanges = [
  "2024-06-01 08:00-10:00",
  "2024-06-01 10:00-12:00",
  "2024-06-02 08:00-10:00"
];

export const spectrumByWafer = spectrumObjects.reduce((acc, row) => {
  if (!acc[row.waferId]) {
    acc[row.waferId] = [];
  }
  row.spectrumIds.forEach((id) => {
    if (!acc[row.waferId].includes(id)) {
      acc[row.waferId].push(id);
    }
  });
  return acc;
}, {});

export const basisCdRows = [
  { id: "CD01", name: "Line CD", current: 32.4, nominal: 32.0, range: "31.5-33.2", unit: "nm" },
  { id: "CD02", name: "Pitch", current: 64.1, nominal: 64.0, range: "63.0-65.0", unit: "nm" },
  { id: "CD03", name: "Top CD", current: 29.8, nominal: 30.0, range: "29.0-31.0", unit: "nm" }
];

export const constraintCdRows = [
  { id: "CCD-01", name: "Sidewall", depends: "CD01/CD03", relation: "CD01 - CD03", current: 2.6 },
  { id: "CCD-02", name: "Bias", depends: "CD02", relation: "CD02 * 0.03", current: 1.9 }
];

export const materialSummary = {
  materials: ["SiO2", "SiN", "Photoresist", "ARC"],
  model: "HO",
  oscillators: 4
};

export const seedCandidates = [
  { name: "SiO2", nk: "n=1.46, k=0" },
  { name: "SiN", nk: "n=2.0, k=0.02" },
  { name: "ARC", nk: "n=1.8, k=0.12" }
];

export const runEvents = [
  { time: "10:02", seed: "S1", step: "Seed Search", result: "Accepted", note: "GOF improved" },
  { time: "10:06", seed: "S1", step: "Fitting", result: "Rejected", note: "KPI failed" },
  { time: "10:10", seed: "S2", step: "Fitting", result: "Accepted", note: "R2 0.982" },
  { time: "10:13", seed: "S2", step: "Linearization", result: "Accepted", note: "Slope stable" }
];

export const historyRows = [
  { runId: "R-24031", modelId: "M-ALD-77", owner: "L. Chen", status: "running", bestKpi: "-", time: "Today 09:58" },
  { runId: "R-24029", modelId: "M-ALD-65", owner: "J. Wu", status: "paused", bestKpi: "0.88", time: "Today 07:12" },
  { runId: "R-24021", modelId: "M-ET-21", owner: "Y. Zhang", status: "succeeded", bestKpi: "0.95", time: "Yesterday 15:22" }
];

export const templates = [
  { name: "Dense Gate V3", materials: "SiO2/SiN", owner: "L. Chen", updated: "2024-06-01" },
  { name: "Spacer Etch B", materials: "ARC/PR", owner: "S. Li", updated: "2024-05-18" },
  { name: "High-K Stack", materials: "HfO2/SiO2", owner: "J. Wu", updated: "2024-05-02" }
];

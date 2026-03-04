import React, { useEffect, useMemo, useRef, useState } from "react";
import MultiSelectDropdown from "../../components/MultiSelectDropdown.jsx";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import { buildHashHref } from "../../router.js";
import {
  createModelWorkspace,
  getPrecisionRuntimeCache,
  getPrecisionSelection,
  getSpectrumRuntimeCache,
  getSpectrumSelection,
  loadRecipeSchema,
  loadWorkspaceCaseCache,
  recipeHubModelVersionExists,
  saveRecipeSchema,
  saveWorkspaceCaseCacheSection,
  shouldPersistWorkspaceCaseCache,
  waitForRecipeHubHydration,
  setPrecisionRuntimeCache,
  setPrecisionSelection,
  setSpectrumRuntimeCache,
  setSpectrumSelection
} from "../../data/mockApi.js";
import { SPECTRUM_API_BASE } from "../../config/env.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";
const DEFAULT_POINT_IDS = Array.from({ length: 17 }).map(
  (_, index) => `point_${index + 1}`
);

const formatDateTimeLocal = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const formatCompactDateParam = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  const datePart = text.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart.replaceAll("-", "");
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (v) => String(v).padStart(2, "0");
  return `${parsed.getFullYear()}${pad(parsed.getMonth() + 1)}${pad(parsed.getDate())}`;
};

const formatPointLabel = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace("-", "_");
  const match = normalized.match(/^point_(\d+)$/i);
  if (match) {
    return `point_${Number(match[1])}`;
  }
  return raw.toLowerCase();
};

const precisionChannelDefsByMode = (mode) => {
  if (mode === "SR") {
    return [
      { key: "te", label: "TE", source: "sr" },
      { key: "tm", label: "TM", source: "sr" }
    ];
  }
  if (mode === "Combine") {
    return [
      { key: "n", label: "N", source: "se" },
      { key: "c", label: "C", source: "se" },
      { key: "s", label: "S", source: "se" },
      { key: "te", label: "TE", source: "sr" },
      { key: "tm", label: "TM", source: "sr" }
    ];
  }
  return [
    { key: "n", label: "N", source: "se" },
    { key: "c", label: "C", source: "se" },
    { key: "s", label: "S", source: "se" }
  ];
};

const buildPointPlotTraces = (pointCurves, mode) => {
  const palette = [
    "#28d1c6",
    "#ffb547",
    "#6ddcff",
    "#ff7a90",
    "#8f7cff",
    "#59d38c",
    "#f6d365",
    "#ff9f43"
  ];
  const channels = precisionChannelDefsByMode(mode);
  const traces = [];
  const pointOrder = {};
  const pointLegendShown = new Set();
  let pointCounter = 0;
  (pointCurves || []).forEach((curve, rowIndex) => {
    const pointId = curve.point_id || curve.pointId || `point_${rowIndex + 1}`;
    const pointLabel = formatPointLabel(pointId);
    const repeatId = curve.repeat_id || curve.repeatId || "Repeat_0001";
    if (pointOrder[pointId] === undefined) {
      pointOrder[pointId] = pointCounter;
      pointCounter += 1;
    }
    const color = palette[pointOrder[pointId] % palette.length];
    channels.forEach((channel, channelIndex) => {
      const source = curve?.[channel.source] || {};
      const x = source.wavelength || [];
      const y = source[channel.key] || [];
      if (!x.length || !y.length) return;
      const axisSuffix = channelIndex === 0 ? "" : `${channelIndex + 1}`;
      traces.push({
        x,
        y,
        type: "scatter",
        mode: "lines",
        name: pointLabel,
        legendgroup: pointId,
        showlegend: channelIndex === 0 && !pointLegendShown.has(pointId),
        line: { color, width: 1.2 },
        xaxis: `x${axisSuffix}`,
        yaxis: `y${axisSuffix}`,
        meta: {
          pointId,
          pointLabel,
          repeatId,
          channel: channel.label
        },
        hovertemplate:
          "%{meta.pointLabel} / %{meta.repeatId} / %{meta.channel}<br>Wavelength=%{x:.1f}<br>Value=%{y:.4f}<extra></extra>"
      });
      if (channelIndex === 0 && !pointLegendShown.has(pointId)) {
        pointLegendShown.add(pointId);
      }
    });
  });
  return traces;
};

const normalizePointPlotPayload = (payload) => {
  if (Array.isArray(payload?.points)) {
    return payload.points.map((item, index) => ({
      point_id: item.point_id || item.pointId || `point_${index + 1}`,
      repeat_id: item.repeat_id || item.repeatId || "Repeat_0001",
      se_filename: item.se_filename || "",
      sr_filename: item.sr_filename || "",
      se_meta_info: item.se_meta_info || {},
      sr_meta_info: item.sr_meta_info || {},
      se: item.se || {},
      sr: item.sr || {}
    }));
  }
  const out = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return out;
  }
  Object.entries(payload).forEach(([pointId, repeats]) => {
    if (!repeats || typeof repeats !== "object" || Array.isArray(repeats)) return;
    Object.entries(repeats).forEach(([repeatId, item]) => {
      if (!item || typeof item !== "object") return;
      out.push({
        point_id: pointId,
        repeat_id: repeatId,
        se_filename: item.se_filename || "",
        sr_filename: item.sr_filename || "",
        se_meta_info: item.se_meta_info || {},
        sr_meta_info: item.sr_meta_info || {},
        se: item.se || {},
        sr: item.sr || {}
      });
    });
  });
  return out;
};

const buildPointCurvesFromStore = (store, selectedPointIds = []) => {
  const pointsInStore = Object.keys(store || {});
  const pointIds = selectedPointIds.length ? selectedPointIds : pointsInStore;
  const curves = [];
  pointIds.forEach((pointId) => {
    const repeats = store?.[pointId];
    if (!repeats || typeof repeats !== "object") return;
    Object.entries(repeats).forEach(([repeatId, payload]) => {
      curves.push({
        point_id: pointId,
        repeat_id: repeatId,
        se_filename: payload?.seFilename || payload?.se_filename || "",
        sr_filename: payload?.srFilename || payload?.sr_filename || "",
        se_meta_info: payload?.seMeta || payload?.se_meta_info || {},
        sr_meta_info: payload?.srMeta || payload?.sr_meta_info || {},
        se: payload?.se || {},
        sr: payload?.sr || {}
      });
    });
  });
  return curves;
};

const getRecordId = (row) => row?.id || row?.record_id || row?.recordId || "";

const buildObjectRowKey = (row, index = 0) => {
  const recordId = getRecordId(row);
  if (recordId) return `id:${recordId}`;
  const tool = row?.tool || "";
  const recipe = row?.recipeName || row?.recipe || "";
  const lot = row?.lotId || row?.lot || "";
  const wafer = row?.waferId || row?.wafer || "";
  const path = row?.spectrumFolder || row?.file_path || "";
  const time = row?.time || "";
  return `row:${tool}|${recipe}|${lot}|${wafer}|${path}|${time}|${index}`;
};

const normalizeObjectRows = (rows = []) =>
  (rows || []).map((row, index) => ({
    ...row,
    _recordId: getRecordId(row),
    _rowKey: row?._rowKey || buildObjectRowKey(row, index)
  }));

export default function Precision({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const now = useMemo(() => new Date(), []);
  const oneWeekAgo = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date;
  }, []);
  const [timeStart, setTimeStart] = useState(formatDateTimeLocal(oneWeekAgo));
  const [timeEnd, setTimeEnd] = useState(formatDateTimeLocal(now));
  const [machineId, setMachineId] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [lotId, setLotId] = useState("");
  const [measurePosition, setMeasurePosition] = useState("T1");
  const [selectedWafers, setSelectedWafers] = useState([]);
  const [selectedPoints, setSelectedPoints] = useState([]);
  const [showTable, setShowTable] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [precisionSpecType, setPrecisionSpecType] = useState("SE");
  const [minWavelength, setMinWavelength] = useState("");
  const [maxWavelength, setMaxWavelength] = useState("");
  const [summaryRows, setSummaryRows] = useState([]);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState("");
  const [pointPlotMode, setPointPlotMode] = useState("SE");
  const [pointPlotCurves, setPointPlotCurves] = useState([]);
  const [pointPlotLoading, setPointPlotLoading] = useState(false);
  const [pointPlotError, setPointPlotError] = useState("");
  const [showRecipePrompt, setShowRecipePrompt] = useState(false);
  const [modelIdInput, setModelIdInput] = useState("");
  const [versionInput, setVersionInput] = useState("v1");
  const [modelIdError, setModelIdError] = useState("");
  const [creatingRecipe, setCreatingRecipe] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [loadingImport, setLoadingImport] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [timeFiltered, setTimeFiltered] = useState([]);
  const [filterOptions, setFilterOptions] = useState({
    toolOptions: [],
    recipeOptions: [],
    lotOptions: [],
    waferOptions: []
  });
  const [spectraStore, setSpectraStore] = useState({});
  const [selectedSpectrumTable, setSelectedSpectrumTable] = useState([]);
  const [importedObjectRows, setImportedObjectRows] = useState([]);
  const [restoreHint, setRestoreHint] = useState("");
  const [themeTick, setThemeTick] = useState(0);
  const restoringRef = useRef(false);
  const restoreHydrationRef = useRef(false);
  const pointPlotRef = useRef(null);
  const pointPlotlyRef = useRef(null);
  const isSelectionForWorkspace = (selection) => {
    if (!selection || typeof selection !== "object") return false;
    if (!workspaceId) return false;
    return String(selection.workspaceId || "") === String(workspaceId);
  };

  const handleConfirm = () => {
    setShowTable(true);
  };

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const html = document.documentElement;
    const body = document.body;
    const onThemeMaybeChanged = () => setThemeTick((value) => value + 1);
    const observer = new MutationObserver(onThemeMaybeChanged);
    observer.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    if (body) {
      observer.observe(body, { attributes: true, attributeFilter: ["data-theme"] });
    }
    return () => observer.disconnect();
  }, []);

  const normalizeLoadedSpectra = (payload) => {
    if (Array.isArray(payload?.spectra)) {
      return payload.spectra.map((item) => ({
        waferId: item.wafer_id || item.waferId,
        spectrumId: item.spectrum_id || item.spectrumId,
        seFilename: item.se_filename || "",
        srFilename: item.sr_filename || "",
        seMetaInfo: item.se_meta_info || {},
        srMetaInfo: item.sr_meta_info || {},
        se: item?.se || {},
        sr: item?.sr || {},
        sourcePath: item.source_path || ""
      }));
    }
    const rows = [];
    if (payload && typeof payload === "object") {
      Object.entries(payload).forEach(([waferId, spectraMap]) => {
        if (!spectraMap || typeof spectraMap !== "object") return;
        Object.entries(spectraMap).forEach(([spectrumId, item]) => {
          rows.push({
            waferId,
            spectrumId,
            seFilename: item?.se_filename || "",
            srFilename: item?.sr_filename || "",
            seMetaInfo: item?.se_meta_info || {},
            srMetaInfo: item?.sr_meta_info || {},
            se: item?.se || {},
            sr: item?.sr || {},
            sourcePath: item?.source_path || ""
          });
        });
      });
    }
    return rows;
  };

  const loadPrecisionSpectra = async (rows, measurePos = measurePosition) => {
    const response = await fetch(`${SPECTRUM_API_BASE}/get_spectra`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        measure_pos: measurePos,
        wafer_info_list: rows.map((row) => ({
          tool: row.tool,
          recipe: row.recipeName,
          lot: row.lotId || "",
          wafer: row.waferId,
          file_path: row.spectrumFolder,
          record_id: row._recordId || row.id || row.record_id || row.recordId || ""
        }))
      })
    });
    if (!response.ok) {
      throw new Error("Failed to load precision spectra via API");
    }
    const data = await response.json();
    const loadedSpectra = normalizeLoadedSpectra(data);
    const expectedCount = loadedSpectra.length;
    const store = {};
    const table = [];
    let loaded = 0;
    loadedSpectra.forEach((item) => {
      const waferId = item.waferId;
      const spectrumId = item.spectrumId;
      if (!waferId || !spectrumId) return;
      if (!store[waferId]) {
        store[waferId] = {};
      }
      store[waferId][spectrumId] = {
        seFilename: item.seFilename || "",
        srFilename: item.srFilename || "",
        seMeta: item.seMetaInfo || {},
        srMeta: item.srMetaInfo || {},
        se: {
          wavelength: item.se?.wavelength || [],
          n: item.se?.n || [],
          c: item.se?.c || [],
          s: item.se?.s || []
        },
        sr: {
          wavelength: item.sr?.wavelength || [],
          te: item.sr?.te || [],
          tm: item.sr?.tm || []
        },
        path: item.sourcePath || ""
      };
      table.push({
        waferId,
        spectrumId,
        path: item.sourcePath || "",
        seFilename: item.seFilename || "",
        srFilename: item.srFilename || ""
      });
      loaded += 1;
      if (expectedCount > 0) {
        setLoadingProgress(Math.round((loaded / expectedCount) * 100));
      }
    });
    return { store, table };
  };

  const toWaferInfoList = (rows) =>
    (rows || []).map((row) => ({
      tool: row.tool,
      recipe: row.recipeName,
      lot: row.lotId || "",
      wafer: row.waferId,
      file_path: row.spectrumFolder,
      record_id: row._recordId || row.id || row.record_id || row.recordId || ""
    }));

  const handleImport = async () => {
    if (selectedRows.length === 0) return;
    const chosen = filteredObjects.filter((row) => selectedRows.includes(row._rowKey));
    setRecordsError("");
    setRestoreHint("");
    setCalcError("");
    setSummaryRows([]);
    setPointPlotError("");
    setPointPlotCurves([]);
    setLoadingImport(true);
    setLoadingProgress(0);
    try {
      const { store, table } = await loadPrecisionSpectra(chosen, measurePosition);
      setSpectraStore(store);
      setSelectedSpectrumTable(table);
      setImportedObjectRows(chosen);
      const wafers = Object.keys(store);
      const spectraByWafer = {};
      wafers.forEach((waferId) => {
        spectraByWafer[waferId] = Object.keys(store[waferId] || {});
      });
      const pointIdsInStore = Object.keys(store || {}).filter((key) => /^repeat\//i.test(key));
      const defaultPoints = selectedPoints.length
        ? selectedPoints
        : pointIdsInStore.length
          ? [pointIdsInStore[0]]
          : ["point_1"];
      setSelectedPoints(defaultPoints);
      setPrecisionSelection({
        workspaceId,
        timeRange: { start: timeStart, end: timeEnd },
        tool: machineId,
        recipeName,
        lotId,
        measurePosition,
        specType: precisionSpecType,
        pointPlotMode,
        inputWaferIds: selectedWafers,
        wafers,
        selectedRows,
        objectRows: chosen,
        selectedSpectra: table,
        spectraByWafer,
        restoreReady: true
      });
      setPointPlotLoading(true);
      let autoCurves = [];
      try {
        autoCurves = buildPointCurvesFromStore(store, defaultPoints);
        if (!autoCurves.length) {
          autoCurves = await requestPointPlotCurves(
            chosen,
            defaultPoints,
            pointPlotMode,
            measurePosition
          );
        }
        setPointPlotCurves(autoCurves);
      } catch (error) {
        setPointPlotCurves([]);
        setPointPlotError(error?.message || "Failed to load point spectra.");
      } finally {
        setPointPlotLoading(false);
      }
      const runtimeSnapshot = buildPrecisionRuntimeSnapshot(
        chosen,
        store,
        table,
        [],
        true,
        defaultPoints,
        autoCurves
      );
      setPrecisionRuntimeCache(workspaceId, runtimeSnapshot);
      await persistWorkspacePrecisionCache({
        selection: {
          timeRange: { start: timeStart, end: timeEnd },
          tool: machineId,
          recipeName,
          lotId,
          measurePosition,
          specType: precisionSpecType,
          pointPlotMode,
          inputWaferIds: selectedWafers,
          wafers,
          selectedRows,
          objectRows: chosen,
          selectedSpectra: table,
          spectraByWafer,
          restoreReady: true
        },
        runtime: runtimeSnapshot
      });
      setShowSummary(true);
    } catch (error) {
      setRecordsError("Failed to load spectra from API.");
    } finally {
      setLoadingImport(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchRecords = async () => {
      setRecordsLoading(true);
      setRecordsError("");
      try {
        const params = new URLSearchParams();
        if (timeStart) params.set("start", formatCompactDateParam(timeStart));
        if (timeEnd) params.set("end", formatCompactDateParam(timeEnd));
        const response = await fetch(`${SPECTRUM_API_BASE}/records?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Records API failed");
        }
        const data = await response.json();
        if (!cancelled) {
          setTimeFiltered(normalizeObjectRows(data.records || []));
        }
      } catch (error) {
        if (!cancelled) {
          setTimeFiltered([]);
          setRecordsError("Failed to query object-storage records from API.");
        }
      } finally {
        if (!cancelled) setRecordsLoading(false);
      }
    };
    fetchRecords();
    return () => {
      cancelled = true;
    };
  }, [timeStart, timeEnd]);

  const withSelected = (options, selectedValues) =>
    Array.from(new Set([...(options || []), ...(selectedValues || []).filter(Boolean)]));

  const fetchFieldOptions = async ({ field, tools = [], recipes = [], lots = [] }) => {
    const appendList = (params, key, values) => {
      (values || []).forEach((value) => {
        if (value !== undefined && value !== null && String(value).trim()) {
          params.append(key, String(value).trim());
        }
      });
    };
    const params = new URLSearchParams();
    if (timeStart) params.set("start", formatCompactDateParam(timeStart));
    if (timeEnd) params.set("end", formatCompactDateParam(timeEnd));
    params.set("field", field);
    appendList(params, "tool", tools);
    appendList(params, "recipe", recipes);
    appendList(params, "lot", lots);
    const response = await fetch(`${SPECTRUM_API_BASE}/filter-options?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Filter options API failed for field=${field}`);
    }
    const data = await response.json();
    return Array.isArray(data.options) ? data.options : [];
  };

  useEffect(() => {
    let cancelled = false;
    const fetchToolOptions = async () => {
      try {
        const toolOptions = await fetchFieldOptions({ field: "tool" });
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          toolOptions: withSelected(toolOptions, [machineId]),
          recipeOptions: [],
          lotOptions: [],
          waferOptions: []
        }));
      } catch (_error) {
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          toolOptions: [],
          recipeOptions: [],
          lotOptions: [],
          waferOptions: []
        }));
      }
    };
    fetchToolOptions();
    return () => {
      cancelled = true;
    };
  }, [timeStart, timeEnd]);

  useEffect(() => {
    let cancelled = false;
    if (!machineId) {
      setFilterOptions((prev) => ({
        ...prev,
        recipeOptions: [],
        lotOptions: [],
        waferOptions: []
      }));
      return () => {
        cancelled = true;
      };
    }
    const fetchRecipeOptions = async () => {
      try {
        const recipeOptions = await fetchFieldOptions({
          field: "recipe",
          tools: [machineId]
        });
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          recipeOptions: withSelected(recipeOptions, [recipeName]),
          lotOptions: [],
          waferOptions: []
        }));
      } catch (_error) {
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          recipeOptions: [],
          lotOptions: [],
          waferOptions: []
        }));
      }
    };
    fetchRecipeOptions();
    return () => {
      cancelled = true;
    };
  }, [timeStart, timeEnd, machineId]);

  useEffect(() => {
    let cancelled = false;
    if (!machineId || !recipeName) {
      setFilterOptions((prev) => ({
        ...prev,
        lotOptions: [],
        waferOptions: []
      }));
      return () => {
        cancelled = true;
      };
    }
    const fetchLotOptions = async () => {
      try {
        const lotOptions = await fetchFieldOptions({
          field: "lot",
          tools: [machineId],
          recipes: [recipeName]
        });
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          lotOptions: withSelected(lotOptions, [lotId]),
          waferOptions: []
        }));
      } catch (_error) {
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          lotOptions: [],
          waferOptions: []
        }));
      }
    };
    fetchLotOptions();
    return () => {
      cancelled = true;
    };
  }, [timeStart, timeEnd, machineId, recipeName]);

  useEffect(() => {
    let cancelled = false;
    if (!machineId || !recipeName || !lotId) {
      setFilterOptions((prev) => ({
        ...prev,
        waferOptions: []
      }));
      return () => {
        cancelled = true;
      };
    }
    const fetchWaferOptions = async () => {
      try {
        const waferOptions = await fetchFieldOptions({
          field: "wafer",
          tools: [machineId],
          recipes: [recipeName],
          lots: [lotId]
        });
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          waferOptions: withSelected(
            waferOptions,
            Array.isArray(selectedWafers) ? selectedWafers : []
          )
        }));
      } catch (_error) {
        if (cancelled) return;
        setFilterOptions((prev) => ({
          ...prev,
          waferOptions: []
        }));
      }
    };
    fetchWaferOptions();
    return () => {
      cancelled = true;
    };
  }, [timeStart, timeEnd, machineId, recipeName, lotId, selectedWafers]);

  const toolOptions = filterOptions.toolOptions;
  const recipeOptions = filterOptions.recipeOptions;
  const lotOptions = filterOptions.lotOptions;
  const waferOptions = filterOptions.waferOptions;

  const filteredObjects = useMemo(() => {
    return timeFiltered.filter((row) => {
      const toolOk = machineId ? row.tool === machineId : true;
      const recipeOk = recipeName ? row.recipeName === recipeName : true;
      const lotOk = lotId ? row.lotId === lotId : true;
      const waferOk = selectedWafers.length ? selectedWafers.includes(row.waferId) : true;
      return toolOk && recipeOk && lotOk && waferOk;
    });
  }, [timeFiltered, machineId, recipeName, lotId, selectedWafers]);
  const filteredObjectIds = useMemo(() => filteredObjects.map((row) => row._rowKey), [filteredObjects]);
  const allFilteredRowsSelected = useMemo(
    () =>
      filteredObjectIds.length > 0 &&
      filteredObjectIds.every((id) => selectedRows.includes(id)),
    [filteredObjectIds, selectedRows]
  );
  const toggleSelectAllFilteredRows = () => {
    setSelectedRows((prev) => {
      if (allFilteredRowsSelected) {
        return prev.filter((id) => !filteredObjectIds.includes(id));
      }
      return Array.from(new Set([...prev, ...filteredObjectIds]));
    });
  };

  const importedWafers = useMemo(() => Object.keys(spectraStore), [spectraStore]);
  const importedSpectraByWafer = useMemo(() => {
    const map = {};
    importedWafers.forEach((waferId) => {
      map[waferId] = Object.keys(spectraStore[waferId] || {});
    });
    return map;
  }, [importedWafers, spectraStore]);

  const importedSpectrumCount = useMemo(() => selectedSpectrumTable.length, [selectedSpectrumTable]);
  const pointPlotTraces = useMemo(
    () => buildPointPlotTraces(pointPlotCurves, pointPlotMode),
    [pointPlotCurves, pointPlotMode]
  );
  const pointOptions = useMemo(() => {
    const fromStore = Object.keys(spectraStore || {}).filter((key) => /^repeat\//i.test(key));
    if (fromStore.length) {
      return fromStore.map((value) => ({ value, label: formatPointLabel(value) }));
    }
    const fromCurves = Array.from(
      new Set((pointPlotCurves || []).map((row) => row.point_id || row.pointId).filter(Boolean))
    );
    if (fromCurves.length > 1) {
      return fromCurves.map((value) => ({ value, label: formatPointLabel(value) }));
    }
    // Precision load may lazily initialize only point_1; keep full selectable catalog.
    if (fromCurves.length === 1 && String(fromCurves[0]).toLowerCase() === "point_1") {
      return DEFAULT_POINT_IDS.map((value) => ({ value, label: formatPointLabel(value) }));
    }
    const fromSummary = Array.from(new Set((summaryRows || []).map((row) => row.point).filter(Boolean)));
    if (fromSummary.length) {
      return fromSummary.map((value) => ({ value, label: formatPointLabel(value) }));
    }
    return DEFAULT_POINT_IDS.map((value) => ({ value, label: formatPointLabel(value) }));
  }, [spectraStore, pointPlotCurves, summaryRows]);

  const requestPointPlotCurves = async (
    rows,
    pointIds,
    mode = pointPlotMode,
    measurePos = measurePosition
  ) => {
    const response = await fetch(`${SPECTRUM_API_BASE}/precision-point-plot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        measure_pos: measurePos,
        spec_type: mode,
        point_ids: pointIds,
        wafer_info_list: toWaferInfoList(rows)
      })
    });
    if (!response.ok) {
      throw new Error("Precision point plot API failed.");
    }
    const data = await response.json();
    return normalizePointPlotPayload(data);
  };

  const handleLoadPointPlot = async () => {
    if (!importedObjectRows.length) {
      setPointPlotError("Please import data before plotting by point.");
      return;
    }
    if (!selectedPoints.length) {
      setPointPlotError("Please select at least one Point ID.");
      return;
    }
    const curvesFromStore = buildPointCurvesFromStore(spectraStore, selectedPoints);
    if (curvesFromStore.length) {
      setPointPlotError("");
      setPointPlotCurves(curvesFromStore);
      const runtimeSnapshot = buildPrecisionRuntimeSnapshot(
        importedObjectRows,
        spectraStore,
        selectedSpectrumTable,
        summaryRows,
        showSummary,
        selectedPoints,
        curvesFromStore
      );
      setPrecisionRuntimeCache(workspaceId, runtimeSnapshot);
      persistWorkspacePrecisionCache({
        selection: {
          timeRange: { start: timeStart, end: timeEnd },
          tool: machineId,
          recipeName,
          lotId,
          measurePosition,
          specType: precisionSpecType,
          pointPlotMode,
          inputWaferIds: selectedWafers,
          wafers: importedWafers,
          selectedRows,
          objectRows: importedObjectRows,
          selectedSpectra: selectedSpectrumTable,
          summaryRows,
          points: selectedPoints,
          restoreReady: showSummary && importedObjectRows.length > 0 && selectedSpectrumTable.length > 0
        },
        runtime: runtimeSnapshot
      });
      return;
    }
    setPointPlotLoading(true);
    setPointPlotError("");
    try {
      const curves = await requestPointPlotCurves(
        importedObjectRows,
        selectedPoints,
        pointPlotMode,
        measurePosition
      );
      setPointPlotCurves(curves);
      const runtimeSnapshot = buildPrecisionRuntimeSnapshot(
        importedObjectRows,
        spectraStore,
        selectedSpectrumTable,
        summaryRows,
        showSummary,
        selectedPoints,
        curves
      );
      setPrecisionRuntimeCache(workspaceId, runtimeSnapshot);
      persistWorkspacePrecisionCache({
        selection: {
          timeRange: { start: timeStart, end: timeEnd },
          tool: machineId,
          recipeName,
          lotId,
          measurePosition,
          specType: precisionSpecType,
          pointPlotMode,
          inputWaferIds: selectedWafers,
          wafers: importedWafers,
          selectedRows,
          objectRows: importedObjectRows,
          selectedSpectra: selectedSpectrumTable,
          summaryRows,
          points: selectedPoints,
          restoreReady: showSummary && importedObjectRows.length > 0 && selectedSpectrumTable.length > 0
        },
        runtime: runtimeSnapshot
      });
    } catch (error) {
      setPointPlotCurves([]);
      setPointPlotError(error?.message || "Failed to load point spectra.");
    } finally {
      setPointPlotLoading(false);
    }
  };

  const handleCalculateSummary = async () => {
    if (!importedObjectRows.length) {
      setCalcError("Please import data before calculating precision summary.");
      return;
    }

    const parseOptionalNumber = (value, label) => {
      const raw = String(value || "").trim();
      if (!raw) return "default";
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${label} must be a number or empty(default).`);
      }
      return parsed;
    };

    let minPayload;
    let maxPayload;
    try {
      minPayload = parseOptionalNumber(minWavelength, "Min wavelength");
      maxPayload = parseOptionalNumber(maxWavelength, "Max wavelength");
    } catch (error) {
      setCalcError(error.message || "Invalid wavelength input.");
      return;
    }

    setCalcLoading(true);
    setCalcError("");
    try {
      const response = await fetch(`${SPECTRUM_API_BASE}/precision-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          measure_pos: measurePosition,
          spec_type: precisionSpecType,
          min_wavelength: minPayload,
          max_wavelength: maxPayload,
          wafer_info_list: toWaferInfoList(importedObjectRows)
        })
      });
      if (!response.ok) {
        throw new Error("Precision summary API failed.");
      }
      const data = await response.json();
      const rows = Array.isArray(data.points) ? data.points : [];
      const mappedRows = rows.map((row) => ({
        point: row.point,
        std: Number(row.std)
      }));
      setSummaryRows(
        mappedRows
      );
      setShowSummary(true);
      const runtimeSnapshot = buildPrecisionRuntimeSnapshot(
        importedObjectRows,
        spectraStore,
        selectedSpectrumTable,
        mappedRows,
        true,
        selectedPoints,
        pointPlotCurves
      );
      setPrecisionRuntimeCache(workspaceId, runtimeSnapshot);
      persistWorkspacePrecisionCache({
        selection: {
          timeRange: { start: timeStart, end: timeEnd },
          tool: machineId,
          recipeName,
          lotId,
          measurePosition,
          specType: precisionSpecType,
          pointPlotMode,
          inputWaferIds: selectedWafers,
          wafers: importedWafers,
          selectedRows,
          objectRows: importedObjectRows,
          selectedSpectra: selectedSpectrumTable,
          summaryRows: mappedRows,
          points: selectedPoints,
          restoreReady: importedObjectRows.length > 0 && selectedSpectrumTable.length > 0
        },
        runtime: runtimeSnapshot
      });
    } catch (error) {
      setCalcError(error?.message || "Failed to calculate precision summary.");
    } finally {
      setCalcLoading(false);
    }
  };

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    const finishRestore = () => {
      setTimeout(() => {
        restoringRef.current = false;
        restoreHydrationRef.current = false;
      }, 0);
    };

    const restore = async () => {
      const cache = getPrecisionRuntimeCache(workspaceId);
      const schema = loadRecipeSchema(workspaceId);
      const saved = schema?.precision || null;
      const tempRaw = getPrecisionSelection(workspaceId) || null;
      const temp = isSelectionForWorkspace(tempRaw) ? tempRaw : null;
      const persistedCache = shouldPersistWorkspaceCaseCache(workspaceId)
        ? await loadWorkspaceCaseCache(workspaceId)
        : null;
      if (cancelled) return;
      const persistedSelection = persistedCache?.precision?.selection || null;
      const persistedRuntime = persistedCache?.precision?.runtime || null;
      const source = persistedSelection || temp || saved;
      const runtime = cache || persistedRuntime || null;
      if (!source && !runtime) return;

      restoringRef.current = true;
      restoreHydrationRef.current = true;
      setRestoreHint("");
      if (source?.timeRange?.start) setTimeStart(source.timeRange.start);
      if (source?.timeRange?.end) setTimeEnd(source.timeRange.end);
      setMachineId(source?.tool || "");
      setRecipeName(source?.recipeName || "");
      setLotId(source?.lotId || "");
      setMeasurePosition(source?.measurePosition || "T1");
      setPrecisionSpecType(source?.specType || "SE");
      setPointPlotMode(source?.pointPlotMode || source?.specType || "SE");
      setMinWavelength(
        source?.minWavelength === "default" || source?.minWavelength === undefined
          ? ""
          : String(source.minWavelength)
      );
      setMaxWavelength(
        source?.maxWavelength === "default" || source?.maxWavelength === undefined
          ? ""
          : String(source.maxWavelength)
      );
      setSummaryRows(Array.isArray(source?.summaryRows) ? source.summaryRows : []);
      // Keep Inputs.Wafer ID independent from point list loaded for plotting.
      setSelectedWafers(Array.isArray(source?.inputWaferIds) ? source.inputWaferIds : []);
      setSelectedRows(source?.selectedRows || []);
      setSelectedPoints(source?.points || []);
      setImportedObjectRows(normalizeObjectRows(Array.isArray(source?.objectRows) ? source.objectRows : []));
      if (source?.selectedRows && source.selectedRows.length) {
        setShowTable(true);
      }

      if (runtime) {
        setMeasurePosition(runtime.measurePosition || source?.measurePosition || "T1");
        setImportedObjectRows(
          normalizeObjectRows(Array.isArray(runtime.objectRows) ? runtime.objectRows : source?.objectRows || [])
        );
        setSpectraStore(runtime.store || {});
        setSelectedSpectrumTable(
          Array.isArray(runtime.selectedSpectrumTable) ? runtime.selectedSpectrumTable : []
        );
        setSummaryRows(Array.isArray(runtime.summaryRows) ? runtime.summaryRows : []);
        setShowSummary(runtime.showSummary !== undefined ? Boolean(runtime.showSummary) : true);
        setSelectedPoints(Array.isArray(runtime.selectedPoints) ? runtime.selectedPoints : source?.points || []);
        setPointPlotCurves(Array.isArray(runtime.pointPlotCurves) ? runtime.pointPlotCurves : []);
        setPointPlotMode(runtime.pointPlotMode || source?.pointPlotMode || source?.specType || "SE");
        setPrecisionSpecType(runtime.precisionSpecType || source?.specType || "SE");
        if (runtime.minWavelength === "default" || runtime.minWavelength === undefined) setMinWavelength("");
        if (runtime.maxWavelength === "default" || runtime.maxWavelength === undefined) setMaxWavelength("");
        if (runtime.minWavelength !== "default" && runtime.minWavelength !== undefined) {
          setMinWavelength(String(runtime.minWavelength));
        }
        if (runtime.maxWavelength !== "default" && runtime.maxWavelength !== undefined) {
          setMaxWavelength(String(runtime.maxWavelength));
        }
        setPrecisionRuntimeCache(workspaceId, runtime);
        setLoadingImport(false);
        setLoadingProgress(0);
        finishRestore();
        return;
      }

      const savedRows = normalizeObjectRows(Array.isArray(source?.objectRows) ? source.objectRows : []);
      const savedTable = Array.isArray(source?.selectedSpectra) ? source.selectedSpectra : [];
      setShowSummary(Boolean(Array.isArray(source?.summaryRows) && source.summaryRows.length));
      setSpectraStore({});
      setSelectedSpectrumTable(savedTable);
      setImportedObjectRows(savedRows);
      setPointPlotCurves(Array.isArray(source?.pointPlotCurves) ? source.pointPlotCurves : []);
      if (savedRows.length && savedTable.length) {
        setRestoreHint("Precision cache not found in memory. Please click Import Data to reload once.");
      } else if (!savedRows.length && savedTable.length) {
        setRestoreHint("Missing import source rows. Re-import once to enable cache restore.");
      }
      setLoadingImport(false);
      setLoadingProgress(0);
      finishRestore();
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setMachineId("");
    setRecipeName("");
    setLotId("");
    setSelectedWafers([]);
    setShowTable(false);
    setSelectedRows([]);
    setShowSummary(false);
    setSpectraStore({});
    setSelectedSpectrumTable([]);
    setSummaryRows([]);
    setCalcError("");
    setPointPlotError("");
    setPointPlotCurves([]);
  }, [timeStart, timeEnd]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setRecipeName("");
    setLotId("");
    setSelectedWafers([]);
    setShowTable(false);
    setSelectedRows([]);
    setShowSummary(false);
    setSummaryRows([]);
    setCalcError("");
    setPointPlotError("");
    setPointPlotCurves([]);
  }, [machineId]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setLotId("");
    setSelectedWafers([]);
    setShowTable(false);
    setSelectedRows([]);
    setShowSummary(false);
    setSummaryRows([]);
    setCalcError("");
    setPointPlotError("");
    setPointPlotCurves([]);
  }, [recipeName]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setSelectedWafers([]);
    setShowTable(false);
    setSelectedRows([]);
    setShowSummary(false);
    setSummaryRows([]);
    setCalcError("");
    setPointPlotError("");
    setPointPlotCurves([]);
  }, [lotId]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setShowTable(false);
    setSelectedRows([]);
    setShowSummary(false);
    setSpectraStore({});
    setSelectedSpectrumTable([]);
    setSummaryRows([]);
    setCalcError("");
    setPointPlotError("");
    setPointPlotCurves([]);
  }, [measurePosition]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setShowTable(false);
    setSelectedRows([]);
    setShowSummary(false);
    setSummaryRows([]);
    setCalcError("");
    setPointPlotError("");
    setPointPlotCurves([]);
  }, [selectedWafers]);

  const maxStdPoint = useMemo(() => {
    if (!summaryRows.length) return null;
    return summaryRows.reduce((acc, row) => (row.std > acc.std ? row : acc), summaryRows[0]);
  }, [summaryRows]);

  const buildPrecisionRuntimeSnapshot = (
    nextObjectRows = importedObjectRows,
    nextStore = spectraStore,
    nextSelectedTable = selectedSpectrumTable,
    nextSummaryRows = summaryRows,
    nextShowSummary = showSummary,
    nextPoints = selectedPoints,
    nextPointCurves = pointPlotCurves
  ) => ({
    measurePosition,
    objectRows: nextObjectRows,
    store: nextStore,
    selectedSpectrumTable: nextSelectedTable,
    summaryRows: nextSummaryRows,
    showSummary: nextShowSummary,
    selectedPoints: nextPoints,
    pointPlotCurves: nextPointCurves,
    pointPlotMode,
    precisionSpecType,
    minWavelength: minWavelength.trim() === "" ? "default" : Number(minWavelength),
    maxWavelength: maxWavelength.trim() === "" ? "default" : Number(maxWavelength)
  });

  const persistWorkspacePrecisionCache = async (payload) => {
    if (!workspaceId) return;
    if (!shouldPersistWorkspaceCaseCache(workspaceId)) return;
    await saveWorkspaceCaseCacheSection(workspaceId, "precision", payload || {});
  };

  const buildPrecisionPayload = (modelID) => ({
    modelID: modelID || workspaceId || "",
    precision: {
      worstPointId: maxStdPoint?.point || null,
      timeRange: { start: timeStart, end: timeEnd },
      tool: machineId,
      recipeName,
      lotId,
      measurePosition,
      specType: precisionSpecType,
      pointPlotMode,
      inputWaferIds: selectedWafers,
      minWavelength: minWavelength.trim() === "" ? "default" : Number(minWavelength),
      maxWavelength: maxWavelength.trim() === "" ? "default" : Number(maxWavelength),
      wafers: importedWafers,
      selectedRows,
      points: selectedPoints,
      selectedSpectra: selectedSpectrumTable,
      summaryRows
    }
  });

  const handleSaveStep = async () => {
    if (!workspaceId) return;
    const isTempWorkspace = workspaceId === "temp";
    const objectRows = importedObjectRows.length
      ? importedObjectRows
      : (Array.isArray(getPrecisionSelection(workspaceId)?.objectRows)
        ? getPrecisionSelection(workspaceId).objectRows
        : []);
    const selectionPayload = {
      workspaceId,
      timeRange: { start: timeStart, end: timeEnd },
      tool: machineId,
      recipeName,
      lotId,
      measurePosition,
      specType: precisionSpecType,
      pointPlotMode,
      inputWaferIds: selectedWafers,
      minWavelength: minWavelength.trim() === "" ? "default" : Number(minWavelength),
      maxWavelength: maxWavelength.trim() === "" ? "default" : Number(maxWavelength),
      wafers: importedWafers,
      selectedRows,
      objectRows,
      selectedSpectra: selectedSpectrumTable,
      summaryRows,
      spectraByWafer: importedSpectraByWafer,
      restoreReady: showSummary && objectRows.length > 0 && selectedSpectrumTable.length > 0
    };
    setPrecisionSelection(selectionPayload);
    const runtimeSnapshot = buildPrecisionRuntimeSnapshot(
      objectRows,
      spectraStore,
      selectedSpectrumTable,
      summaryRows,
      showSummary,
      selectedPoints,
      pointPlotCurves
    );
    setPrecisionRuntimeCache(workspaceId, runtimeSnapshot);
    if (!isTempWorkspace) {
      saveRecipeSchema(workspaceId, buildPrecisionPayload());
      await persistWorkspacePrecisionCache({
        selection: selectionPayload,
        runtime: runtimeSnapshot
      });
    }
    return true;
  };

  const handleNextStep = async () => {
    if (workspaceId && workspaceId !== "temp") {
      window.location.hash = buildHashHref(`/ocd/workspace/${workspaceId}/pre-recipe/recipe-setup`);
      return;
    }
    setShowRecipePrompt(true);
    setModelIdError("");
    if (workspaceId && workspaceId !== "temp") {
      setModelIdInput(workspaceId);
      const schema = loadRecipeSchema(workspaceId) || {};
      setVersionInput(String(schema?.version || "v1"));
    }
  };

  const confirmEnterRecipe = async () => {
    if (creatingRecipe) {
      return;
    }
    const finalModelId = workspaceId && workspaceId !== "temp" ? workspaceId : modelIdInput.trim();
    const finalVersion = String(versionInput || "").trim() || "v1";
    if (!finalModelId) {
      setModelIdError("Model ID is required to create a recipe.");
      return;
    }
    setCreatingRecipe(true);
    setModelIdError("");
    try {
      if (!workspaceId || workspaceId === "temp") {
        await waitForRecipeHubHydration();
        const exists = recipeHubModelVersionExists(finalModelId, finalVersion);
        if (exists) {
          setModelIdError(
            `Model ID "${finalModelId}" with version "${finalVersion}" already exists in Recipe Hub. Please check and retry.`
          );
          return;
        }
        const recipeNameForWorkspace = recipeName || "New Recipe";
        const workspace = createModelWorkspace({
          modelID: finalModelId,
          recipeName: recipeNameForWorkspace,
          owner: "You",
          project: "",
          productID: "",
          loop: "",
          layout: "Default",
          state: "draft",
          version: finalVersion
        });

        const promotedWorkspaceId = workspace.id;
        const spectrumSelection = getSpectrumSelection(workspaceId);
        if (spectrumSelection && (!spectrumSelection.workspaceId || spectrumSelection.workspaceId === "temp")) {
          const promotedSpectrumSelection = {
            ...spectrumSelection,
            workspaceId: promotedWorkspaceId
          };
          setSpectrumSelection(promotedSpectrumSelection);
          const spectrumRuntime = getSpectrumRuntimeCache("temp");
          if (spectrumRuntime) {
            setSpectrumRuntimeCache(promotedWorkspaceId, spectrumRuntime);
          }
          await saveWorkspaceCaseCacheSection(promotedWorkspaceId, "spectrum", {
            selection: promotedSpectrumSelection,
            runtime: spectrumRuntime || {}
          });
        }

        const currentPrecisionSelection = getPrecisionSelection(workspaceId);
        const promotedPrecisionSelection = {
          ...(currentPrecisionSelection || {}),
          workspaceId: promotedWorkspaceId,
          timeRange: { start: timeStart, end: timeEnd },
          tool: machineId,
          recipeName,
          lotId,
          measurePosition,
          specType: precisionSpecType,
          pointPlotMode,
          inputWaferIds: selectedWafers,
          wafers: importedWafers,
          selectedRows,
          objectRows: importedObjectRows,
          selectedSpectra: selectedSpectrumTable,
          summaryRows,
          points: selectedPoints,
          spectraByWafer: importedSpectraByWafer,
          restoreReady: showSummary && importedObjectRows.length > 0 && selectedSpectrumTable.length > 0
        };
        setPrecisionSelection(promotedPrecisionSelection);
        const precisionRuntime = getPrecisionRuntimeCache("temp");
        const promotedPrecisionRuntime =
          precisionRuntime ||
          buildPrecisionRuntimeSnapshot(
            importedObjectRows,
            spectraStore,
            selectedSpectrumTable,
            summaryRows,
            showSummary,
            selectedPoints,
            pointPlotCurves
          );
        setPrecisionRuntimeCache(promotedWorkspaceId, promotedPrecisionRuntime);
        await saveWorkspaceCaseCacheSection(promotedWorkspaceId, "precision", {
          selection: promotedPrecisionSelection,
          runtime: promotedPrecisionRuntime
        });

        saveRecipeSchema(workspace.id, buildPrecisionPayload(workspace.modelID));
        await saveWorkspaceCaseCacheSection(promotedWorkspaceId, "schema", {
          recipeSchema: loadRecipeSchema(promotedWorkspaceId) || {}
        });
        window.location.hash = buildHashHref(`/ocd/workspace/${workspace.id}/pre-recipe/recipe-setup`);
        return;
      }
      await handleSaveStep();
      window.location.hash = buildHashHref(`/ocd/workspace/${workspaceId}/pre-recipe/recipe-setup`);
    } finally {
      setCreatingRecipe(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!pointPlotRef.current || !pointPlotTraces.length) {
      return undefined;
    }

    const renderPlot = async () => {
      try {
        const module = await import("plotly.js-dist-min");
        const Plotly = module.default || module;
        pointPlotlyRef.current = Plotly;
        if (cancelled || !pointPlotRef.current) return;

        const html = document.documentElement;
        const body = document.body;
        const root = body || html;
        const css = getComputedStyle(root);
        const themeMode =
          html.getAttribute("data-theme") ||
          (body ? body.getAttribute("data-theme") : "") ||
          "dark";
        const textColor = css.getPropertyValue("--text").trim() || "#d8e6ff";
        const axisColor = themeMode === "light" ? textColor : "rgba(232, 238, 248, 0.95)";
        const gridColor =
          themeMode === "light" ? "rgba(170, 182, 201, 0.35)" : "rgba(215, 229, 248, 0.28)";
        const lineColor =
          themeMode === "light" ? "rgba(120, 136, 160, 0.55)" : "rgba(230, 240, 255, 0.72)";
        const channels = precisionChannelDefsByMode(pointPlotMode);
        const buildAxis = (title) => ({
          title: { text: title, font: { color: axisColor } },
          tickfont: { color: axisColor },
          color: axisColor,
          showline: true,
          linecolor: lineColor,
          gridcolor: gridColor,
          zerolinecolor: gridColor
        });
        const layout = {
          grid: { rows: channels.length, columns: 1, pattern: "independent" },
          margin: { l: 55, r: 140, t: 20, b: 40 },
          font: { color: textColor },
          showlegend: true,
          legend: { x: 1.02, y: 1, orientation: "v", font: { color: axisColor } },
          plot_bgcolor: "rgba(0,0,0,0)",
          paper_bgcolor: "rgba(0,0,0,0)"
        };
        channels.forEach((channel, idx) => {
          const axisSuffix = idx === 0 ? "" : `${idx + 1}`;
          layout[`xaxis${axisSuffix}`] = buildAxis("Wavelength (nm)");
          layout[`yaxis${axisSuffix}`] = buildAxis(channel.label);
        });
        Plotly.react(pointPlotRef.current, pointPlotTraces, layout, {
          responsive: true,
          displayModeBar: false
        });
      } catch (_error) {
        if (!cancelled) {
          setPointPlotError("Plotly failed to load. Please refresh.");
        }
      }
    };

    renderPlot();
    return () => {
      cancelled = true;
      if (pointPlotlyRef.current && pointPlotRef.current) {
        pointPlotlyRef.current.purge(pointPlotRef.current);
      }
    };
  }, [pointPlotTraces, pointPlotMode, themeTick]);

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pre-Recipe</p>
          <h2>Precision Evaluation</h2>
          <p className="subtle">Analyze repeatability and batch plot spectra by point.</p>
        </div>
        <div />
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Inputs</h3>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Time Range</label>
            <div className="inline-actions">
              <input
                type="datetime-local"
                value={timeStart}
                onChange={(event) => setTimeStart(event.target.value)}
              />
              <span>to</span>
              <input
                type="datetime-local"
                value={timeEnd}
                onChange={(event) => setTimeEnd(event.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <label>Tool</label>
            <select
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
            >
              <option value="">Select tool</option>
              {toolOptions.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Recipe Name</label>
            <select
              value={recipeName}
              onChange={(event) => setRecipeName(event.target.value)}
            >
              <option value="">Select recipe</option>
              {recipeOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Lot ID</label>
            <select
              value={lotId}
              onChange={(event) => setLotId(event.target.value)}
            >
              <option value="">Select lot</option>
              {lotOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Measure Position</label>
            <select
              value={measurePosition}
              onChange={(event) => setMeasurePosition(event.target.value)}
            >
              <option value="T1">T1</option>
              <option value="T2">T2</option>
            </select>
          </div>
          <div className="form-row">
            <label>Wafer ID</label>
            <MultiSelectDropdown
              label="WaferID"
              options={waferOptions.map((id) => ({ value: id, label: id }))}
              value={selectedWafers}
              onChange={setSelectedWafers}
            />
          </div>
          <div className="form-row">
            <button className="primary-button" onClick={handleConfirm}>Confirm</button>
          </div>
        </div>
        {recordsLoading ? <p className="panel-note">Querying object-storage records...</p> : null}
        {recordsError ? <p className="panel-note">{recordsError}</p> : null}
        {restoreHint ? <p className="panel-note">{restoreHint}</p> : null}
      </section>

      {showTable ? (
        <section className="panel">
          <div className="panel-header">
            <h3>Object Storage Records</h3>
            <span className="chip">Select rows to import</span>
          </div>
          <div className="table-scroll">
            <div className="table object-storage-table object-storage-with-lot">
              <div className="table-row table-head">
                <span className="table-head-select">
                  <button
                    type="button"
                    className={`table-select-dot${allFilteredRowsSelected ? " active" : ""}`}
                    onClick={toggleSelectAllFilteredRows}
                    disabled={!filteredObjectIds.length}
                    aria-label={allFilteredRowsSelected ? "Clear selection" : "Select all rows"}
                  />
                  Select
                </span>
                <span>Time</span>
                <span>Tool</span>
                <span>Recipe</span>
                <span>Lot ID</span>
                <span>Wafer ID</span>
                <span>Folder Path</span>
              </div>
              {filteredObjects.map((row) => (
                <div className="table-row" key={row._rowKey}>
                  <input
                    type="checkbox"
                    checked={selectedRows.includes(row._rowKey)}
                    onChange={() =>
                      setSelectedRows((prev) =>
                        prev.includes(row._rowKey)
                          ? prev.filter((id) => id !== row._rowKey)
                          : [...prev, row._rowKey]
                      )
                    }
                  />
                  <span>{row.time.replace("T", " ")}</span>
                  <span>{row.tool}</span>
                  <span>{row.recipeName}</span>
                  <span>{row.lotId || "-"}</span>
                  <span>{row.waferId}</span>
                  <span className="mono">{row.spectrumFolder}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="inline-actions">
            <button className="primary-button" onClick={handleImport}>Import Data</button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h3>Precision Summary</h3>
          <div className="inline-actions">
            <button className="ghost-button">Export</button>
          </div>
        </div>
        {showSummary ? (
          <>
            <p className="panel-note">
              Loaded: {importedWafers.length} wafers / {importedSpectrumCount} spectra
            </p>
            <div className="inline-actions">
              <div className="form-row">
                <label>Spec_type</label>
                <select
                  value={precisionSpecType}
                  onChange={(event) => setPrecisionSpecType(event.target.value)}
                >
                  <option value="SE">SE</option>
                  <option value="SR">SR</option>
                  <option value="Combine">Combine</option>
                </select>
              </div>
              <div className="form-row">
                <label>Min Wavelength</label>
                <input
                  type="text"
                  placeholder="default"
                  value={minWavelength}
                  onChange={(event) => setMinWavelength(event.target.value)}
                />
              </div>
              <div className="form-row">
                <label>Max Wavelength</label>
                <input
                  type="text"
                  placeholder="default"
                  value={maxWavelength}
                  onChange={(event) => setMaxWavelength(event.target.value)}
                />
              </div>
              <div className="form-row">
                <label>&nbsp;</label>
                <button className="primary-button" onClick={handleCalculateSummary} disabled={calcLoading}>
                  {calcLoading ? "Calculating..." : "Calculate"}
                </button>
              </div>
            </div>
            {calcError ? <p className="panel-note">{calcError}</p> : null}
            <div className="table">
              <div className="table-row table-head">
                <span>Point</span>
                <span>Std</span>
              </div>
              {summaryRows.map((row) => (
                <div className="table-row" key={row.point}>
                  <span>{formatPointLabel(row.point)}</span>
                  <span>{row.std.toFixed(6)}</span>
                </div>
              ))}
            </div>
            {maxStdPoint ? (
              <p className="panel-note">
                Max STD point: {formatPointLabel(maxStdPoint.point)} (Std {maxStdPoint.std.toFixed(6)})
              </p>
            ) : null}
          </>
        ) : (
          <div className="plot-placeholder">Start analysis to load summary</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Spectrum Plot (by Point ID)</h3>
          <div />
        </div>
        <div className="inline-actions">
          {["SE", "SR", "Combine"].map((mode) => (
            <label className="checkbox-row" key={mode}>
              <input
                type="checkbox"
                checked={pointPlotMode === mode}
                onChange={() => setPointPlotMode(mode)}
              />
              <span>{mode}</span>
            </label>
          ))}
        </div>
        <div className="form-row">
          <label>Point ID (multi)</label>
          <MultiSelectDropdown
            label="Point ID"
            options={pointOptions}
            value={selectedPoints}
            onChange={setSelectedPoints}
          />
        </div>
        <div className="inline-actions top-pad">
          <button className="primary-button" onClick={handleLoadPointPlot} disabled={pointPlotLoading}>
            {pointPlotLoading ? "Loading Plot..." : "Load Point Plot"}
          </button>
        </div>
        {pointPlotError ? <p className="panel-note">{pointPlotError}</p> : null}
        {pointPlotTraces.length ? (
          <div ref={pointPlotRef} className="plot-placeholder" style={{ minHeight: "520px" }} />
        ) : (
          <div className="plot-placeholder">
            Plotly Precision Container (Points: {selectedPoints.map(formatPointLabel).join(", ") || "None"})
          </div>
        )}
      </section>
      <WorkflowFooter
        workspaceId={workspaceId}
        onSave={handleSaveStep}
        onNext={workspaceId === "temp" ? undefined : handleNextStep}
        nextLabel={workspaceId === "temp" ? "End of Explore" : "Next Step"}
        readOnly={readOnly}
      />
      {showRecipePrompt ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Enter Recipe Setup?</h3>
            <p className="summary-label">
              Confirm to start a formal recipe. Current spectra and future inputs will be saved as a draft.
            </p>
            <div className="form-row">
              <label>Model ID</label>
              <input
                type="text"
                value={workspaceId && workspaceId !== "temp" ? workspaceId : modelIdInput}
                disabled={Boolean(workspaceId && workspaceId !== "temp") || creatingRecipe}
                onChange={(event) => setModelIdInput(event.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Version</label>
              <input
                type="text"
                value={versionInput}
                disabled={creatingRecipe}
                onChange={(event) => setVersionInput(event.target.value)}
                placeholder="v1"
              />
            </div>
            {modelIdError ? <p className="panel-note">{modelIdError}</p> : null}
            <div className="inline-actions">
              <button className="ghost-button" onClick={() => setShowRecipePrompt(false)} disabled={creatingRecipe}>
                Not Now
              </button>
              <button className="primary-button" onClick={confirmEnterRecipe} disabled={creatingRecipe}>
                {creatingRecipe ? "Checking..." : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {loadingImport ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Loading Spectra</h3>
            <p className="summary-label">Loading selected precision spectra…</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

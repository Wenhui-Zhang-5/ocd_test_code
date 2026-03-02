import React, { useEffect, useMemo, useRef, useState } from "react";
import MultiSelectDropdown from "../../components/MultiSelectDropdown.jsx";
import WorkflowFooter from "../../components/WorkflowFooter.jsx";
import {
  clearSpectrumRuntimeCache,
  getSpectrumRuntimeCache,
  getSpectrumSelection,
  loadRecipeSchema,
  loadWorkspaceCaseCache,
  saveRecipeSchema,
  saveWorkspaceCaseCacheSection,
  shouldPersistWorkspaceCaseCache,
  setSpectrumRuntimeCache,
  setSpectrumSelection
} from "../../data/mockApi.js";
import { OUTLIER_API_URL, SPECTRUM_API_BASE } from "../../config/env.js";
import { isWorkspaceReadOnly } from "../../data/workspaceAccess.js";

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

const channelDefsByMode = (mode) => {
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

const buildTracesFromStore = (store, mode) => {
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
  const channels = channelDefsByMode(mode);
  const waferIds = Object.keys(store || {});
  const colorMap = waferIds.reduce((acc, waferId, index) => {
    acc[waferId] = palette[index % palette.length];
    return acc;
  }, {});
  const legendShown = new Set();
  const traces = [];

  waferIds.forEach((waferId) => {
    const spectra = store[waferId] || {};
    Object.entries(spectra).forEach(([spectrumId, payload]) => {
      let canShowLegend = !legendShown.has(waferId);
      channels.forEach((channel, idx) => {
        const axisSuffix = idx === 0 ? "" : `${idx + 1}`;
        const xAxis = `x${axisSuffix}`;
        const yAxis = `y${axisSuffix}`;
        const source = payload[channel.source] || {};
        const x = source.wavelength || [];
        const y = source[channel.key] || [];
        if (!x.length || !y.length) {
          return;
        }
        traces.push({
          x,
          y,
          type: "scatter",
          mode: "lines",
          name: waferId,
          legendgroup: waferId,
          showlegend: canShowLegend,
          line: { color: colorMap[waferId] || "#28d1c6" },
          xaxis: xAxis,
          yaxis: yAxis,
          meta: { waferId, spectrumId },
          hovertemplate:
            "%{meta.waferId} / %{meta.spectrumId}<br>Wavelength=%{x:.1f}<br>Value=%{y:.4f}<extra></extra>"
        });
        if (canShowLegend) {
          legendShown.add(waferId);
          canShowLegend = false;
        }
      });
    });
  });
  return traces;
};

const getRecordId = (row) => row?.id || row?.record_id || row?.recordId || "";

const buildObjectRowKey = (row, index = 0) => {
  const recordId = getRecordId(row);
  if (recordId) return `id:${recordId}`;
  const tool = row?.tool || "";
  const recipe = row?.recipeName || row?.recipe || "";
  const lot = row?.lotId || row?.lot || row?.lotid || "";
  const wafer = row?.waferId || row?.wafer || row?.waferid || "";
  const path = row?.spectrumFolder || row?.file_path || row?.path || "";
  const time = row?.time || "";
  return `row:${tool}|${recipe}|${lot}|${wafer}|${path}|${time}|${index}`;
};

const normalizeObjectRows = (rows = []) =>
  (rows || []).map((row, index) => ({
    ...row,
    _recordId: getRecordId(row),
    _rowKey: row?._rowKey || buildObjectRowKey(row, index)
  }));

export default function Spectrum({ workspaceId }) {
  const readOnly = isWorkspaceReadOnly(workspaceId);
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(now.getDate() - 7);
  const [timeStart, setTimeStart] = useState(formatDateTimeLocal(oneWeekAgo));
  const [timeEnd, setTimeEnd] = useState(formatDateTimeLocal(now));
  const [machineId, setMachineId] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [lotId, setLotId] = useState("");
  const [measurePosition, setMeasurePosition] = useState("T1");
  const [selectedWafers, setSelectedWafers] = useState([]);
  const [highlightSelections, setHighlightSelections] = useState({});
  const [highlightedSpectra, setHighlightedSpectra] = useState([]);
  const [showTable, setShowTable] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);
  const [showPlot, setShowPlot] = useState(false);
  const [importError, setImportError] = useState("");
  const [loadingImport, setLoadingImport] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [plotData, setPlotData] = useState([]);
  const [originalPlotData, setOriginalPlotData] = useState([]);
  const [plotError, setPlotError] = useState("");
  const [spectraStore, setSpectraStore] = useState({});
  const [originalSpectraStore, setOriginalSpectraStore] = useState({});
  const [selectedSpectrumTable, setSelectedSpectrumTable] = useState([]);
  const [originalSpectrumTable, setOriginalSpectrumTable] = useState([]);
  const [importedObjectRows, setImportedObjectRows] = useState([]);
  const [restoreHint, setRestoreHint] = useState("");
  const [outlierThreshold, setOutlierThreshold] = useState(2.5);
  const [outlierMethod, setOutlierMethod] = useState("zscore");
  const [outliers, setOutliers] = useState([]);
  const [outlierLoading, setOutlierLoading] = useState(false);
  const [outlierError, setOutlierError] = useState("");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [showOutlierPanel, setShowOutlierPanel] = useState(false);
  const [showHighlightPanel, setShowHighlightPanel] = useState(false);
  const [plotChannelMode, setPlotChannelMode] = useState("SE");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [timeFiltered, setTimeFiltered] = useState([]);
  const [filterOptions, setFilterOptions] = useState({
    toolOptions: [],
    recipeOptions: [],
    lotOptions: [],
    waferOptions: []
  });
  const [themeTick, setThemeTick] = useState(0);
  const plotRef = useRef(null);
  const plotlyRef = useRef(null);
  const restoringRef = useRef(false);
  const restoreHydrationRef = useRef(false);
  const isSelectionForWorkspace = (selection) => {
    if (!selection || typeof selection !== "object") return false;
    if (!workspaceId) return false;
    return String(selection.workspaceId || "") === String(workspaceId);
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

  const pickSelectedData = ({ store, spectrumTable }, selectedTable = []) => {
    if (!selectedTable.length) {
      return { store, spectrumTable };
    }
    const selectedSet = new Set(selectedTable.map((row) => `${row.waferId}::${row.spectrumId}`));
    const nextStore = {};
    Object.entries(store || {}).forEach(([waferId, spectra]) => {
      const kept = {};
      Object.entries(spectra || {}).forEach(([spectrumId, payload]) => {
        if (selectedSet.has(`${waferId}::${spectrumId}`)) {
          kept[spectrumId] = payload;
        }
      });
      if (Object.keys(kept).length) {
        nextStore[waferId] = kept;
      }
    });
    const nextTable = spectrumTable.filter((row) => selectedSet.has(`${row.waferId}::${row.spectrumId}`));
    return { store: nextStore, spectrumTable: nextTable };
  };

  const buildViewerSnapshot = (objectRows = []) => ({
    timeRange: { start: timeStart, end: timeEnd },
    machineId,
    recipeName,
    lotId,
    measurePosition,
    selectedWafers,
    showTable,
    selectedRows,
    showPlot,
    objectRows,
    selectedSpectrumTable,
    highlightSelections,
    highlightedSpectra,
    outlierThreshold: Number(outlierThreshold) || 2.5,
    outlierMethod,
    outliers,
    showAdvancedTools,
    showOutlierPanel,
    showHighlightPanel,
    plotChannelMode,
    restoreReady:
      showPlot &&
      Array.isArray(objectRows) &&
      objectRows.length > 0 &&
      Array.isArray(selectedSpectrumTable) &&
      selectedSpectrumTable.length > 0
  });

  const persistWorkspaceSpectrumCache = async (payload) => {
    if (!workspaceId) return;
    if (!shouldPersistWorkspaceCaseCache(workspaceId)) return;
    await saveWorkspaceCaseCacheSection(workspaceId, "spectrum", payload || {});
  };

  const handleConfirm = () => {
    setShowTable(true);
  };

  const normalizeLoadedSpectra = (payload) => {
    if (Array.isArray(payload?.spectra)) {
      return payload.spectra.map((item) => ({
        waferId: item.wafer_id || item.waferId,
        spectrumId: item.spectrum_id || item.spectrumId,
        seFilename: item.se_filename || item.filename || "",
        srFilename: item.sr_filename || "",
        combineFilename: item.combine_filename || item.combineFilename || "",
        seMetaInfo: item.se_meta_info || item.meta_info || {},
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
            seFilename: item?.se_filename || item?.filename || "",
            srFilename: item?.sr_filename || "",
            combineFilename: item?.combine_filename || item?.combineFilename || "",
            seMetaInfo: item?.se_meta_info || item?.meta_info || {},
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

  const loadSpectra = async (rows, measurePos = measurePosition) => {
    const store = {};
    const spectrumTable = [];
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
      throw new Error("Failed to load spectra via API");
    }
    const data = await response.json();
    const loadedSpectra = normalizeLoadedSpectra(data);
    const expectedCount = loadedSpectra.length;
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
        combineFilename: item.combineFilename || "",
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
      spectrumTable.push({
        waferId,
        spectrumId,
        path: item.sourcePath || "",
        seFilename: item.seFilename || "",
        srFilename: item.srFilename || "",
        combineFilename: item.combineFilename || ""
      });
      loaded += 1;
      if (expectedCount > 0) {
        setLoadingProgress(Math.round((loaded / expectedCount) * 100));
      }
    });
    const traces = buildTracesFromStore(store, plotChannelMode);
    return { traces, store, spectrumTable };
  };

  const handleImport = async () => {
    if (selectedRows.length === 0) {
      setImportError("Select at least one row to import.");
      setShowPlot(false);
      return;
    }
    const chosen = filteredObjects.filter((item) => selectedRows.includes(item._rowKey));
    const waferCounts = chosen.reduce((acc, row) => {
      acc[row.waferId] = (acc[row.waferId] || 0) + 1;
      return acc;
    }, {});
    const duplicateWafers = Object.keys(waferCounts).filter((id) => waferCounts[id] > 1);
    if (duplicateWafers.length) {
      setImportError(`Each wafer can only be loaded once. Remove duplicates: ${duplicateWafers.join(", ")}`);
      setShowPlot(false);
      return;
    }
    setImportError("");
    setRestoreHint("");
    setPlotError("");
    setHighlightSelections({});
    setHighlightedSpectra([]);
    setShowPlot(false);
    setPlotData([]);
    setOriginalPlotData([]);
    setSpectraStore({});
    setOriginalSpectraStore({});
    setSelectedSpectrumTable([]);
    setOriginalSpectrumTable([]);
    setOutliers([]);
    setLoadingProgress(0);
    setLoadingImport(true);
    try {
      const { traces, store, spectrumTable } = await loadSpectra(chosen, measurePosition);
      setPlotData(traces);
      setOriginalPlotData(traces);
      setSpectraStore(store);
      setOriginalSpectraStore(store);
      setSelectedSpectrumTable(spectrumTable);
      setOriginalSpectrumTable(spectrumTable);
      setImportedObjectRows(chosen);
      setSpectrumRuntimeCache(workspaceId, {
        measurePosition,
        objectRows: chosen,
        store,
        originalStore: store,
        spectrumTable,
        originalSpectrumTable: spectrumTable
      });
      const nextSelection = {
        workspaceId,
        waferIds: Array.from(new Set(chosen.map((item) => item.waferId))),
        timeRange: { start: timeStart, end: timeEnd },
        machineId,
        recipeName,
        lotId,
        measurePosition,
        objectRows: chosen,
        selectedSpectra: spectrumTable,
        restoreReady: true,
        showPlot: true
      };
      setSpectrumSelection(nextSelection);
      await persistWorkspaceSpectrumCache({
        viewer: buildViewerSnapshot(chosen),
        selection: nextSelection,
        runtime: {
          measurePosition,
          objectRows: chosen,
          store,
          originalStore: store,
          spectrumTable,
          originalSpectrumTable: spectrumTable
        }
      });
      setShowPlot(true);
    } catch (error) {
      setImportError("Failed to load spectra. Please try again.");
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
        if (!cancelled) {
          setRecordsLoading(false);
        }
      }
    };
    fetchRecords();
    return () => {
      cancelled = true;
    };
  }, [timeStart, timeEnd]);

  useEffect(() => {
    let cancelled = false;
    const appendList = (params, key, values) => {
      (values || []).forEach((value) => {
        if (value !== undefined && value !== null && String(value).trim()) {
          params.append(key, String(value).trim());
        }
      });
    };
    const fetchFieldOptions = async ({ field, tools = [], recipes = [], lots = [] }) => {
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
      if (Array.isArray(data.options)) return data.options;
      if (field === "tool" && Array.isArray(data.tool_options)) return data.tool_options;
      if (field === "recipe" && Array.isArray(data.recipe_options)) return data.recipe_options;
      if (field === "lot" && Array.isArray(data.lot_options)) return data.lot_options;
      if (field === "wafer" && Array.isArray(data.wafer_options)) return data.wafer_options;
      return [];
    };
    const fetchFilterOptions = async () => {
      try {
        const selectedTools = machineId ? [machineId] : [];
        const selectedRecipes = recipeName ? [recipeName] : [];
        const selectedLots = lotId ? [lotId] : [];
        const toolOptions = await fetchFieldOptions({ field: "tool" });
        const recipeOptions = await fetchFieldOptions({
          field: "recipe",
          tools: selectedTools
        });
        const lotOptions = await fetchFieldOptions({
          field: "lot",
          tools: selectedTools,
          recipes: selectedRecipes
        });
        const waferOptions = await fetchFieldOptions({
          field: "wafer",
          tools: selectedTools,
          recipes: selectedRecipes,
          lots: selectedLots
        });
        if (cancelled) return;
        const withSelected = (options, selectedValues) =>
          Array.from(new Set([...(options || []), ...(selectedValues || []).filter(Boolean)]));
        setFilterOptions({
          toolOptions: withSelected(Array.isArray(toolOptions) ? toolOptions : [], [machineId]),
          recipeOptions: withSelected(Array.isArray(recipeOptions) ? recipeOptions : [], [recipeName]),
          lotOptions: withSelected(Array.isArray(lotOptions) ? lotOptions : [], [lotId]),
          waferOptions: withSelected(
            Array.isArray(waferOptions) ? waferOptions : [],
            Array.isArray(selectedWafers) ? selectedWafers : []
          )
        });
      } catch (_error) {
        if (cancelled) return;
        setFilterOptions({
          toolOptions: [],
          recipeOptions: [],
          lotOptions: [],
          waferOptions: []
        });
      }
    };
    fetchFilterOptions();
    return () => {
      cancelled = true;
    };
  }, [timeStart, timeEnd, machineId, recipeName, lotId, selectedWafers]);

  const toolOptions = filterOptions.toolOptions;
  const recipeOptions = filterOptions.recipeOptions;
  const lotOptions = filterOptions.lotOptions;
  const waferOptions = filterOptions.waferOptions;

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
      const schema = loadRecipeSchema(workspaceId);
      const savedViewer = schema?.spectrumAnalysis?.spectrumViewer;
      const savedSchemaSelection = schema?.spectrumAnalysis?.spectrumSelection || null;
      const savedGlobalSelectionRaw = getSpectrumSelection(workspaceId);
      const savedGlobalSelection = isSelectionForWorkspace(savedGlobalSelectionRaw)
        ? savedGlobalSelectionRaw
        : null;
      const persistedCache = shouldPersistWorkspaceCaseCache(workspaceId)
        ? await loadWorkspaceCaseCache(workspaceId)
        : null;
      if (cancelled) return;
      const persistedViewer = persistedCache?.spectrum?.viewer || null;
      const persistedSelection = persistedCache?.spectrum?.selection || null;
      const persistedRuntime = persistedCache?.spectrum?.runtime || null;
      const savedSelection = persistedSelection || savedSchemaSelection || savedGlobalSelection || null;
      const saved = persistedViewer || savedViewer || savedSelection;
      if (!saved) return;

      restoringRef.current = true;
      restoreHydrationRef.current = true;
      setRestoreHint("");
      if (saved.timeRange?.start) setTimeStart(saved.timeRange.start);
      if (saved.timeRange?.end) setTimeEnd(saved.timeRange.end);
      setMachineId(saved.machineId || savedSelection?.machineId || "");
      setRecipeName(saved.recipeName || savedSelection?.recipeName || "");
      setLotId(saved.lotId || savedSelection?.lotId || "");
      setMeasurePosition(saved.measurePosition || savedSelection?.measurePosition || "T1");
      setSelectedWafers(saved.waferIds || savedSelection?.waferIds || []);
      if (Array.isArray(saved.selectedWafers)) setSelectedWafers(saved.selectedWafers);
      if (saved.showTable !== undefined) setShowTable(Boolean(saved.showTable));
      if (Array.isArray(saved.selectedRows)) setSelectedRows(saved.selectedRows);
      if (saved.highlightSelections) setHighlightSelections(saved.highlightSelections);
      if (Array.isArray(saved.highlightedSpectra)) setHighlightedSpectra(saved.highlightedSpectra);
      if (saved.outlierThreshold !== undefined) setOutlierThreshold(saved.outlierThreshold);
      if (saved.outlierMethod) setOutlierMethod(saved.outlierMethod);
      if (Array.isArray(saved.outliers)) setOutliers(saved.outliers);
      if (saved.showAdvancedTools !== undefined) setShowAdvancedTools(Boolean(saved.showAdvancedTools));
      if (saved.showOutlierPanel !== undefined) setShowOutlierPanel(Boolean(saved.showOutlierPanel));
      if (saved.showHighlightPanel !== undefined) setShowHighlightPanel(Boolean(saved.showHighlightPanel));
      if (saved.plotChannelMode) setPlotChannelMode(saved.plotChannelMode);

      const savedObjectRowsRaw = Array.isArray(savedSelection?.objectRows)
        ? savedSelection.objectRows
        : Array.isArray(saved.objectRows)
          ? saved.objectRows
          : [];
      const savedObjectRows = normalizeObjectRows(savedObjectRowsRaw);
      const savedSelectedTable = Array.isArray(savedSelection?.selectedSpectra)
        ? savedSelection.selectedSpectra
        : Array.isArray(saved.selectedSpectrumTable)
          ? saved.selectedSpectrumTable
          : [];
      setImportedObjectRows(savedObjectRows);

      if (!saved.selectedRows?.length) {
        setSelectedRows(savedObjectRows.map((row) => row._rowKey));
      }
      if (saved.showTable === undefined) {
        setShowTable(Boolean(saved.selectedRows?.length || savedObjectRows.length));
      }

      const allowAutoRestore =
        (savedSelection?.restoreReady ?? saved.restoreReady) !== false && savedObjectRows.length > 0;

      if (!allowAutoRestore) {
        clearSpectrumRuntimeCache(workspaceId);
        setShowPlot(false);
        setPlotData([]);
        setOriginalPlotData([]);
        setSpectraStore({});
        setOriginalSpectraStore({});
        setSelectedSpectrumTable(savedSelectedTable);
        setOriginalSpectrumTable(savedSelectedTable);
        if (!savedObjectRows.length && savedSelectedTable.length) {
          setRestoreHint("Missing import source rows. Re-import once to enable auto-restore.");
        }
        setLoadingImport(false);
        setLoadingProgress(0);
        finishRestore();
        return;
      }

      const restoredMode = saved.plotChannelMode || "SE";
      const runtime = getSpectrumRuntimeCache(workspaceId) || persistedRuntime || null;
      if (runtime) {
        const selectedTable = savedSelectedTable.length
          ? savedSelectedTable
          : (runtime.spectrumTable || []);
        const picked = pickSelectedData(
          { store: runtime.store || {}, spectrumTable: runtime.spectrumTable || [] },
          selectedTable
        );
        setSpectrumRuntimeCache(workspaceId, runtime);
        setOriginalPlotData(buildTracesFromStore(runtime.originalStore || {}, restoredMode));
        setOriginalSpectraStore(runtime.originalStore || {});
        setOriginalSpectrumTable(runtime.originalSpectrumTable || []);
        setPlotData(buildTracesFromStore(picked.store || {}, restoredMode));
        setSpectraStore(picked.store || {});
        setSelectedSpectrumTable(picked.spectrumTable || []);
        setShowPlot(saved.showPlot === undefined ? true : Boolean(saved.showPlot));
        setLoadingImport(false);
        setLoadingProgress(0);
        finishRestore();
        return;
      }

      setLoadingImport(true);
      setLoadingProgress(0);
      try {
        const { traces, store, spectrumTable } = await loadSpectra(
          savedObjectRows,
          saved.measurePosition || savedSelection?.measurePosition || "T1"
        );
        if (cancelled) return;
        setOriginalPlotData(traces);
        setOriginalSpectraStore(store);
        setOriginalSpectrumTable(spectrumTable);
        const picked = pickSelectedData({ store, spectrumTable }, savedSelectedTable.length ? savedSelectedTable : spectrumTable);
        setPlotData(buildTracesFromStore(picked.store, restoredMode));
        setSpectraStore(picked.store);
        setSelectedSpectrumTable(picked.spectrumTable);
        setSpectrumRuntimeCache(workspaceId, {
          measurePosition: saved.measurePosition || savedSelection?.measurePosition || "T1",
          objectRows: savedObjectRows,
          store: picked.store,
          originalStore: store,
          spectrumTable: picked.spectrumTable,
          originalSpectrumTable: spectrumTable
        });
        setShowPlot(true);
      } catch (error) {
        if (!cancelled) {
          setImportError("Failed to restore spectra.");
          setShowPlot(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingImport(false);
          finishRestore();
        }
      }
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
    setShowPlot(false);
  }, [timeStart, timeEnd]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setRecipeName("");
    setLotId("");
    setSelectedWafers([]);
    setShowTable(false);
    setSelectedRows([]);
    setShowPlot(false);
  }, [machineId]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setLotId("");
    setSelectedWafers([]);
    setShowTable(false);
    setSelectedRows([]);
    setShowPlot(false);
  }, [recipeName]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setSelectedWafers([]);
    setShowTable(false);
    setSelectedRows([]);
    setShowPlot(false);
  }, [lotId]);

  useEffect(() => {
    if (restoringRef.current || restoreHydrationRef.current) return;
    setShowTable(false);
    setSelectedRows([]);
    setShowPlot(false);
  }, [selectedWafers]);

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

  useEffect(() => {
    if (!showPlot) return;
    setPlotData(buildTracesFromStore(spectraStore, plotChannelMode));
    setOriginalPlotData(buildTracesFromStore(originalSpectraStore, plotChannelMode));
  }, [plotChannelMode, showPlot, spectraStore, originalSpectraStore]);

  const importedSpectraByWafer = useMemo(() => {
    const map = {};
    selectedSpectrumTable.forEach((row) => {
      if (!map[row.waferId]) {
        map[row.waferId] = [];
      }
      if (!map[row.waferId].includes(row.spectrumId)) {
        map[row.waferId].push(row.spectrumId);
      }
    });
    return map;
  }, [selectedSpectrumTable]);

  const importedWafers = useMemo(() => Object.keys(importedSpectraByWafer), [importedSpectraByWafer]);

  const importedSpectrumCount = useMemo(() => selectedSpectrumTable.length, [selectedSpectrumTable]);
  const highlightLegend = useMemo(
    () => highlightedSpectra.map((item) => `${item.waferId} / ${item.spectrumId}`),
    [highlightedSpectra]
  );
  const outlierLegend = useMemo(
    () => outliers.map((item) => `${item.waferId} / ${item.spectrumId}`),
    [outliers]
  );

  const styledPlotData = useMemo(() => {
    if (!plotData.length) {
      return plotData;
    }
    if (!highlightedSpectra.length && !outliers.length) {
      return plotData.map((trace) => ({
        ...trace,
        opacity: 0.9,
        line: { ...trace.line, width: 1.2 }
      }));
    }
    const highlightSet = new Set(
      highlightedSpectra.map((item) => `${item.waferId}::${item.spectrumId}`)
    );
    const outlierSet = new Set(outliers.map((item) => `${item.waferId}::${item.spectrumId}`));
    return plotData.map((trace) => {
      const meta = trace.meta || {};
      const key = `${meta.waferId}::${meta.spectrumId}`;
      const isHighlight = highlightSet.has(key);
      const isOutlier = outlierSet.has(key);
      const baseWidth = isHighlight || isOutlier ? 1.8 : 1.0;
      const baseOpacity = isHighlight || isOutlier ? 1 : 0.35;
      return {
        ...trace,
        opacity: baseOpacity,
        line: {
          ...trace.line,
          width: baseWidth,
          color: isHighlight || isOutlier ? "#ff3b4d" : trace.line?.color,
          dash: "solid"
        }
      };
    });
  }, [plotData, highlightedSpectra, outliers]);

  const handleHighlightConfirm = () => {
    if (!showPlot) {
      setImportError("Please click Import Data before selecting spectra to highlight.");
      return;
    }
    const next = Object.entries(highlightSelections)
      .flatMap(([waferId, spectra]) =>
        (spectra || []).map((spectrumId) => ({ waferId, spectrumId }))
      );
    setHighlightedSpectra(next);
  };

  const runOutlierFilter = async () => {
    if (!showPlot || !Object.keys(spectraStore).length) {
      setImportError("Please click Import Data before running outlier filter.");
      return;
    }
    const threshold = Number(outlierThreshold) || 2.5;
    const spectraPayload = [];
    Object.entries(spectraStore).forEach(([waferId, spectra]) => {
      Object.entries(spectra).forEach(([spectrumId, payload]) => {
        spectraPayload.push({
          wafer_id: waferId,
          spectrum_id: spectrumId,
          n: payload?.se?.n || [],
          c: payload?.se?.c || [],
          s: payload?.se?.s || []
        });
      });
    });

    setOutlierLoading(true);
    setOutlierError("");
    try {
      const response = await fetch(OUTLIER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: outlierMethod,
          threshold,
          spectra: spectraPayload
        })
      });
      if (!response.ok) {
        throw new Error("Outlier API failed");
      }
      const data = await response.json();
      const nextOutliers = (data.outliers || []).map((item) => ({
        waferId: item.wafer_id || item.waferId,
        spectrumId: item.spectrum_id || item.spectrumId,
        score: item.score
      }));
      setOutliers(nextOutliers);
    } catch (error) {
      setOutlierError("Outlier service unavailable. Please try again.");
    } finally {
      setOutlierLoading(false);
    }
  };

  const confirmRemoveOutliers = () => {
    if (!outliers.length) {
      return;
    }
    const outlierSet = new Set(outliers.map((item) => `${item.waferId}::${item.spectrumId}`));
    const nextSelectedTable = selectedSpectrumTable.filter(
      (row) => !outlierSet.has(`${row.waferId}::${row.spectrumId}`)
    );
    const nextStore = {};
    Object.entries(spectraStore).forEach(([waferId, spectra]) => {
      const kept = {};
      Object.entries(spectra).forEach(([spectrumId, payload]) => {
        if (!outlierSet.has(`${waferId}::${spectrumId}`)) {
          kept[spectrumId] = payload;
        }
      });
      if (Object.keys(kept).length) {
        nextStore[waferId] = kept;
      }
    });
    setSpectraStore(nextStore);
    setSelectedSpectrumTable((prev) => {
      const next = prev.filter((row) => !outlierSet.has(`${row.waferId}::${row.spectrumId}`));
      const nextSelection = {
        workspaceId,
        waferIds: Array.from(new Set(next.map((row) => row.waferId))),
        timeRange: { start: timeStart, end: timeEnd },
        machineId,
        recipeName,
        lotId,
        measurePosition,
        objectRows: importedObjectRows,
        selectedSpectra: next,
        restoreReady: showPlot && importedObjectRows.length > 0 && next.length > 0,
        showPlot: showPlot && next.length > 0
      };
      setSpectrumSelection(nextSelection);
      persistWorkspaceSpectrumCache({
        viewer: buildViewerSnapshot(importedObjectRows),
        selection: nextSelection,
        runtime: {
          measurePosition,
          objectRows: importedObjectRows,
          store: nextStore,
          originalStore: originalSpectraStore,
          spectrumTable: next,
          originalSpectrumTable
        }
      });
      return next;
    });
    setHighlightSelections((prev) => {
      const nextSelections = {};
      Object.entries(prev).forEach(([waferId, spectra]) => {
        const kept = (spectra || []).filter(
          (spectrumId) => !outlierSet.has(`${waferId}::${spectrumId}`)
        );
        if (kept.length) {
          nextSelections[waferId] = kept;
        }
      });
      return nextSelections;
    });
    setHighlightedSpectra((prev) =>
      prev.filter((row) => !outlierSet.has(`${row.waferId}::${row.spectrumId}`))
    );
    setOutliers([]);
    setSpectrumRuntimeCache(workspaceId, {
      measurePosition,
      objectRows: importedObjectRows,
      store: nextStore,
      originalStore: originalSpectraStore,
      spectrumTable: nextSelectedTable,
      originalSpectrumTable
    });
  };

  const reloadOriginalSpectra = () => {
    if (!originalPlotData.length) {
      return;
    }
    setPlotData(buildTracesFromStore(originalSpectraStore, plotChannelMode));
    setSpectraStore(originalSpectraStore);
    setSelectedSpectrumTable(originalSpectrumTable);
    setOutliers([]);
    setHighlightSelections({});
    setHighlightedSpectra([]);
    const nextSelection = {
      workspaceId,
      waferIds: Array.from(new Set(originalSpectrumTable.map((row) => row.waferId))),
      timeRange: { start: timeStart, end: timeEnd },
      machineId,
      recipeName,
      lotId,
      measurePosition,
      objectRows: importedObjectRows,
      selectedSpectra: originalSpectrumTable,
      restoreReady: showPlot && importedObjectRows.length > 0 && originalSpectrumTable.length > 0,
      showPlot: showPlot && originalSpectrumTable.length > 0
    };
    setSpectrumSelection(nextSelection);
    setSpectrumRuntimeCache(workspaceId, {
      measurePosition,
      objectRows: importedObjectRows,
      store: originalSpectraStore,
      originalStore: originalSpectraStore,
      spectrumTable: originalSpectrumTable,
      originalSpectrumTable
    });
    persistWorkspaceSpectrumCache({
      viewer: buildViewerSnapshot(importedObjectRows),
      selection: nextSelection,
      runtime: {
        measurePosition,
        objectRows: importedObjectRows,
        store: originalSpectraStore,
        originalStore: originalSpectraStore,
        spectrumTable: originalSpectrumTable,
        originalSpectrumTable
      }
    });
  };

  const handleSaveStep = () => {
    setImportError("");
    const selectedSet = new Set(
      selectedSpectrumTable.map((row) => `${row.waferId}::${row.spectrumId}`)
    );
    const removedSpectra = originalSpectrumTable
      .filter((row) => !selectedSet.has(`${row.waferId}::${row.spectrumId}`))
      .map((row) => ({
        waferId: row.waferId,
        spectrumCsv: `${row.spectrumId}.csv`
      }));

    const currentSelection = getSpectrumSelection(workspaceId);
    const scopedSelection = isSelectionForWorkspace(currentSelection) ? currentSelection : null;
    const objectRows = importedObjectRows.length
      ? importedObjectRows
      : (Array.isArray(scopedSelection?.objectRows) ? scopedSelection.objectRows : []);
    const selectionPayload = {
      workspaceId,
      waferIds: Object.keys(spectraStore),
      timeRange: { start: timeStart, end: timeEnd },
      machineId,
      recipeName,
      lotId,
      measurePosition,
      objectRows,
      selectedSpectra: selectedSpectrumTable,
      removedSpectra,
      restoreReady: showPlot && objectRows.length > 0 && selectedSpectrumTable.length > 0,
      showPlot: showPlot && selectedSpectrumTable.length > 0
    };

    setSpectrumSelection(selectionPayload);
    setSpectrumRuntimeCache(workspaceId, {
      measurePosition,
      objectRows,
      store: spectraStore,
      originalStore: originalSpectraStore,
      spectrumTable: selectedSpectrumTable,
      originalSpectrumTable
    });
    const existing = loadRecipeSchema(workspaceId) || {};
    saveRecipeSchema(workspaceId, {
      ...existing,
      spectrumAnalysis: {
        ...(existing.spectrumAnalysis || {}),
        spectrumViewer: buildViewerSnapshot(objectRows),
        spectrumSelection: selectionPayload
      }
    });
    persistWorkspaceSpectrumCache({
      viewer: buildViewerSnapshot(objectRows),
      selection: selectionPayload,
      runtime: {
        measurePosition,
        objectRows,
        store: spectraStore,
        originalStore: originalSpectraStore,
        spectrumTable: selectedSpectrumTable,
        originalSpectrumTable
      }
    });
    return true;
  };
  useEffect(() => {
    let cancelled = false;
    if (!showPlot || !plotRef.current || plotData.length === 0) {
      return undefined;
    }

    const renderPlot = async () => {
      try {
        const module = await import("plotly.js-dist-min");
        const Plotly = module.default || module;
        plotlyRef.current = Plotly;
        if (cancelled || !plotRef.current) {
          return;
        }
        const html = document.documentElement;
        const body = document.body;
        const root = body || html;
        const css = getComputedStyle(root);
        const themeMode =
          html.getAttribute("data-theme") ||
          (body ? body.getAttribute("data-theme") : "") ||
          "dark";
        const textColor = css.getPropertyValue("--text").trim() || "#d8e6ff";
        const axisColor =
          themeMode === "light" ? textColor : "rgba(232, 238, 248, 0.95)";
        const gridColor =
          themeMode === "light" ? "rgba(170, 182, 201, 0.35)" : "rgba(215, 229, 248, 0.28)";
        const lineColor =
          themeMode === "light" ? "rgba(120, 136, 160, 0.55)" : "rgba(230, 240, 255, 0.72)";
        const buildAxis = (title) => ({
          title: { text: title, font: { color: axisColor } },
          tickfont: { color: axisColor },
          color: axisColor,
          showline: true,
          linecolor: lineColor,
          gridcolor: gridColor,
          zerolinecolor: gridColor
        });
        const channelDefs = channelDefsByMode(plotChannelMode);
        const layout = {
          grid: { rows: channelDefs.length, columns: 1, pattern: "independent" },
          margin: { l: 55, r: 140, t: 20, b: 40 },
          font: { color: textColor },
          showlegend: true,
          legend: { x: 1.02, y: 1, orientation: "v", font: { color: axisColor } },
          plot_bgcolor: "rgba(0,0,0,0)",
          paper_bgcolor: "rgba(0,0,0,0)"
        };
        channelDefs.forEach((channel, idx) => {
          const axisSuffix = idx === 0 ? "" : `${idx + 1}`;
          layout[`xaxis${axisSuffix}`] = buildAxis("Wavelength (nm)");
          layout[`yaxis${axisSuffix}`] = buildAxis(channel.label);
        });
        Plotly.react(plotRef.current, styledPlotData, layout, { responsive: true, displayModeBar: false });
      } catch (error) {
        if (!cancelled) {
          setPlotError("Plotly failed to load. Please refresh.");
        }
      }
    };

    renderPlot();
    return () => {
      cancelled = true;
      if (plotlyRef.current && plotRef.current) {
        plotlyRef.current.purge(plotRef.current);
      }
    };
  }, [showPlot, styledPlotData, themeTick, plotChannelMode]);

  return (
    <div className={`page${readOnly ? " read-only" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pre-Recipe</p>
          <h2>Spectrum Viewer</h2>
          <p className="subtle">
            Load DOE spectra by WaferID and compare curves with zoom and highlight.
          </p>
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
          <button className="primary-button" onClick={handleConfirm}>Confirm</button>
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
            <div className="table object-storage-table spectrum-object-storage-table">
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
          <h3>Spectrum Plot</h3>
          <div className="inline-actions">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={plotChannelMode === "SE"}
                onChange={() => setPlotChannelMode("SE")}
              />
              SE
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={plotChannelMode === "SR"}
                onChange={() => setPlotChannelMode("SR")}
              />
              SR
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={plotChannelMode === "Combine"}
                onChange={() => setPlotChannelMode("Combine")}
              />
              Combine
            </label>
            <button
              className="ghost-button"
              onClick={() => {
                setHighlightSelections({});
                setHighlightedSpectra([]);
                setOutliers([]);
              }}
            >
              Clear Highlight
            </button>
          </div>
        </div>
        {showPlot ? (
          <div className="plot-placeholder spectrum-plot">
            {plotError ? (
              <div className="plot-error">{plotError}</div>
            ) : (
              <div className="plotly-container" ref={plotRef} />
            )}
            <p className="plot-meta">
              Loaded: {importedWafers.length} wafers / {importedSpectrumCount} spectra
            </p>
            {outlierLegend.length ? (
              <div className="plot-highlight-legend">
                <strong>Outliers</strong>
                <p>{outlierLegend.join(", ")}</p>
              </div>
            ) : null}
            {highlightLegend.length ? (
              <div className="plot-highlight-legend">
                <strong>Highlighted</strong>
                <p>{highlightLegend.join(", ")}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="plot-placeholder">Import data to load plot</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Advanced Tools</h3>
          <div className="inline-actions">
            <span className="chip">Optional</span>
            <button
              className="ghost-button"
              onClick={() => setShowAdvancedTools((prev) => !prev)}
            >
              {showAdvancedTools ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {!showAdvancedTools ? (
          <p className="panel-note">
            Optional tools for outlier filtering and manual spectrum highlighting.
          </p>
        ) : (
          <>
            <div className="panel inner-panel">
              <div className="panel-header">
                <h3>Outlier Filter (Per Wafer)</h3>
                <div className="inline-actions">
                  <span className="chip">Optional</span>
                  <button
                    className="ghost-button"
                    onClick={() => setShowOutlierPanel((prev) => !prev)}
                  >
                    {showOutlierPanel ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {!showOutlierPanel ? (
                <p className="panel-note">Hidden by default. Enable if you need outlier filtering.</p>
              ) : (
                <>
                  <div className="form-grid two-col">
                    <div className="form-row">
                      <label>Detection Method</label>
                      <select value={outlierMethod} onChange={(event) => setOutlierMethod(event.target.value)}>
                        <option value="zscore">Z-Score (robust)</option>
                        <option value="isolation_forest">Isolation Forest</option>
                        <option value="lof">LOF (Local Outlier Factor)</option>
                      </select>
                    </div>
                    <div className="form-row">
                      <label>
                        {outlierMethod === "zscore"
                          ? "Outlier Threshold (z-score)"
                          : "Outlier Fraction (0-0.5)"}
                      </label>
                      <input
                        type="number"
                        step={outlierMethod === "zscore" ? "0.1" : "0.01"}
                        min={outlierMethod === "zscore" ? undefined : "0.01"}
                        max={outlierMethod === "zscore" ? undefined : "0.5"}
                        value={outlierThreshold}
                        onChange={(event) => setOutlierThreshold(event.target.value)}
                      />
                    </div>
                    <div className="form-row full-row">
                      <label>Actions</label>
                      <div className="inline-actions">
                        <button
                          className="primary-button"
                          onClick={runOutlierFilter}
                          disabled={outlierLoading}
                        >
                          {outlierLoading ? "Detecting..." : "Detect Outliers"}
                        </button>
                        <button
                          className="danger-button"
                          onClick={confirmRemoveOutliers}
                          disabled={!outliers.length}
                        >
                          Confirm Delete
                        </button>
                        <button
                          className="ghost-button"
                          onClick={reloadOriginalSpectra}
                          disabled={!originalPlotData.length}
                        >
                          Reload Original
                        </button>
                      </div>
                    </div>
                  </div>
                  {outlierError ? <p className="panel-note">{outlierError}</p> : null}
                  {outliers.length ? (
                    <>
                      <div className="table">
                        <div className="table-row table-head">
                          <span>Wafer ID</span>
                          <span>Spectrum ID</span>
                          <span>Score</span>
                        </div>
                        {outliers.map((item) => (
                          <div className="table-row" key={`${item.waferId}-${item.spectrumId}`}>
                            <span>{item.waferId}</span>
                            <span>{item.spectrumId}</span>
                            <span>{item.score}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="panel-note">Run the filter to highlight outliers per wafer.</p>
                  )}
                </>
              )}
            </div>

            <div className="panel inner-panel">
              <div className="panel-header">
                <h3>Select Spectrum to Highlight</h3>
                <div className="inline-actions">
                  <span className="chip">Optional</span>
                  <button
                    className="ghost-button"
                    onClick={() => setShowHighlightPanel((prev) => !prev)}
                  >
                    {showHighlightPanel ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {!showHighlightPanel ? (
                <p className="panel-note">Hidden by default. Enable if you need manual spectrum highlighting.</p>
              ) : importedWafers.length ? (
                <>
                  <div className="table">
                    <div className="table-row table-head">
                      <span>Wafer ID</span>
                      <span>Spectrum ID</span>
                    </div>
                    {importedWafers.map((waferId) => (
                      <div className="table-row" key={`highlight-${waferId}`}>
                        <span>{waferId}</span>
                        <MultiSelectDropdown
                          label=""
                          options={(importedSpectraByWafer[waferId] || []).map((id) => ({
                            value: id,
                            label: id
                          }))}
                          value={highlightSelections[waferId] || []}
                          onChange={(next) =>
                            setHighlightSelections((prev) => ({
                              ...prev,
                              [waferId]: next
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div className="inline-actions">
                    <button className="primary-button" onClick={handleHighlightConfirm}>Confirm</button>
                  </div>
                </>
              ) : (
                <p className="panel-note">Import data to select spectra for highlight.</p>
              )}
            </div>
          </>
        )}
      </section>
      <WorkflowFooter workspaceId={workspaceId} onSave={handleSaveStep} readOnly={readOnly} />
      {importError ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Import Check</h3>
            <p className="summary-label">{importError}</p>
            <div className="inline-actions">
              <button className="primary-button" onClick={() => setImportError("")}>OK</button>
            </div>
          </div>
        </div>
      ) : null}
      {loadingImport ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Loading Spectra</h3>
            <p className="summary-label">Loading selected spectra data…</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

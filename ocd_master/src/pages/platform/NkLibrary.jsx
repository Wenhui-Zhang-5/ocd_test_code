import React, { useEffect, useRef, useState } from "react";
import { fetchNkCurve, listNkLibraries, listNkMaterials, listNkModels } from "../../data/mockApi.js";

export default function NkLibrary() {
  const [libraries, setLibraries] = useState([]);
  const [libraryType, setLibraryType] = useState("general");
  const [materials, setMaterials] = useState([]);
  const [selectedMaterial, setSelectedMaterial] = useState("");
  const [models, setModels] = useState([]);
  const [selectedModelValue, setSelectedModelValue] = useState("");
  const [uploadLibrary, setUploadLibrary] = useState("general");
  const [uploadMaterials, setUploadMaterials] = useState([]);
  const [uploadMaterial, setUploadMaterial] = useState("");
  const [convertToHo, setConvertToHo] = useState(false);
  const [conversionStatus, setConversionStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [conversionReady, setConversionReady] = useState(false);
  const [nkCurve, setNkCurve] = useState(null);
  const [nkLoading, setNkLoading] = useState(false);
  const [nkError, setNkError] = useState("");
  const [showParams, setShowParams] = useState(false);
  const plotRef = useRef(null);
  const plotlyRef = useRef(null);

  const modelOptions = models.map((model) => {
    const modelName = model.modelName || "";
    const value = `${model.modelType}::${modelName}`;
    const label = modelName ? `${model.modelType} / ${modelName}` : model.modelType;
    return { ...model, value, label };
  });

  const startConversion = () => {
    setConversionStatus("running");
    setProgress(0);
    setConversionReady(false);
    let current = 0;
    const interval = window.setInterval(() => {
      current += 12 + Math.random() * 10;
      if (current >= 100) {
        window.clearInterval(interval);
        setProgress(100);
        setConversionStatus("done");
        setConversionReady(true);
      } else {
        setProgress(Math.round(current));
      }
    }, 400);
  };

  const handleConvertToggle = (checked) => {
    setConvertToHo(checked);
    if (checked) {
      startConversion();
    } else {
      setConversionStatus("idle");
      setProgress(0);
      setConversionReady(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    listNkLibraries()
      .then((libs) => {
        if (cancelled) return;
        const nextLibraries = libs.length ? libs : ["general"];
        setLibraries(nextLibraries);
        if (!nextLibraries.includes(libraryType)) {
          setLibraryType(nextLibraries[0]);
        }
        if (!nextLibraries.includes(uploadLibrary)) {
          setUploadLibrary(nextLibraries[0]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLibraries(["general"]);
          setLibraryType("general");
          setUploadLibrary("general");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [libraryType, uploadLibrary]);

  useEffect(() => {
    let cancelled = false;
    if (!libraryType) return undefined;
    listNkMaterials(libraryType)
      .then((list) => {
        if (cancelled) return;
        setMaterials(list);
        if (!list.includes(selectedMaterial)) {
          setSelectedMaterial(list[0] || "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMaterials([]);
          setSelectedMaterial("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [libraryType, selectedMaterial]);

  useEffect(() => {
    let cancelled = false;
    if (!uploadLibrary) return undefined;
    listNkMaterials(uploadLibrary)
      .then((list) => {
        if (cancelled) return;
        setUploadMaterials(list);
        if (!list.includes(uploadMaterial)) {
          setUploadMaterial(list[0] || "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUploadMaterials([]);
          setUploadMaterial("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uploadLibrary, uploadMaterial]);

  useEffect(() => {
    let cancelled = false;
    if (!libraryType || !selectedMaterial) return undefined;
    listNkModels(libraryType, selectedMaterial)
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        const nextOptions = list.map((model) => `${model.modelType}::${model.modelName || ""}`);
        if (!nextOptions.includes(selectedModelValue)) {
          setSelectedModelValue(nextOptions[0] || "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModels([]);
          setSelectedModelValue("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [libraryType, selectedMaterial, selectedModelValue]);

  useEffect(() => {
    if (!libraryType || !selectedMaterial || !selectedModelValue) {
      setNkCurve(null);
      setShowParams(false);
      return;
    }
    let cancelled = false;
    setNkLoading(true);
    setNkError("");
    const [modelType, modelName] = selectedModelValue.split("::");
    fetchNkCurve({
      library: libraryType,
      material: selectedMaterial,
      modelType,
      modelName: modelName || undefined
    })
      .then((data) => {
        if (!cancelled) {
          setNkCurve(data);
          setShowParams(false);
        }
      })
      .catch(() => {
        if (!cancelled) setNkError("Failed to load NK curve.");
      })
      .finally(() => {
        if (!cancelled) setNkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryType, selectedMaterial, selectedModelValue]);

  useEffect(() => {
    let cancelled = false;
    if (!plotRef.current || !nkCurve) return undefined;
    const render = async () => {
      try {
        const module = await import("plotly.js-dist-min");
        const Plotly = module.default || module;
        plotlyRef.current = Plotly;
        if (cancelled || !plotRef.current) return;
        const wavelength = nkCurve.wavelength || nkCurve.wavelengths || nkCurve.lambda || [];
        const nValues = nkCurve.n && nkCurve.n.length ? nkCurve.n : nkCurve.N || [];
        const kValues = nkCurve.k && nkCurve.k.length ? nkCurve.k : nkCurve.K || [];
        const themeRoot = document.body?.dataset?.theme ? document.body : document.documentElement;
        const theme = getComputedStyle(themeRoot);
        const textColor = theme.getPropertyValue("--text").trim() || "#e8eef8";
        const borderColor = theme.getPropertyValue("--border").trim() || "#22324f";
        const panelColor = theme.getPropertyValue("--panel").trim() || "rgba(0,0,0,0)";
        const gridColor = borderColor;
        const nTrace = {
          x: wavelength,
          y: nValues,
          type: "scatter",
          mode: "lines",
          name: "N",
          line: { color: "#4aa3ff", width: 2 }
        };
        const kTrace = {
          x: wavelength,
          y: kValues,
          type: "scatter",
          mode: "lines",
          name: "K",
          yaxis: "y2",
          line: { color: "#ff8a3d", width: 2 }
        };
        const layout = {
          margin: { l: 60, r: 60, t: 20, b: 40 },
          font: { color: textColor },
          xaxis: {
            title: "Wavelength (nm)",
            color: textColor,
            tickfont: { color: textColor },
            linecolor: borderColor,
            gridcolor: gridColor
          },
          yaxis: {
            title: "N",
            color: textColor,
            tickfont: { color: textColor },
            linecolor: borderColor,
            gridcolor: gridColor
          },
          yaxis2: {
            title: "K",
            overlaying: "y",
            side: "right",
            color: textColor,
            tickfont: { color: textColor },
            linecolor: borderColor,
            gridcolor: gridColor
          },
          showlegend: true,
          legend: { orientation: "h", x: 0, y: 1.15, font: { color: textColor } },
          plot_bgcolor: panelColor || "rgba(0,0,0,0)",
          paper_bgcolor: panelColor || "rgba(0,0,0,0)"
        };
        await Plotly.react(plotRef.current, [nTrace, kTrace], layout, { displayModeBar: false });
      } catch (error) {
        setNkError("Failed to render NK plot.");
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [nkCurve]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Platform</p>
          <h2>NK Library</h2>
          <p className="subtle">Browse NK curves by general or project library.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>MatLib Viewer</h3>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>Library Type</label>
            <select
              value={libraryType}
              onChange={(event) => {
                const next = event.target.value;
                setLibraryType(next);
              }}
            >
              {libraries.map((lib) => (
                <option key={lib} value={lib}>{lib}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Material</label>
            <select
              value={selectedMaterial}
              onChange={(event) => setSelectedMaterial(event.target.value)}
            >
              {materials.map((material) => (
                <option key={material} value={material}>{material}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>Model</label>
            <select
              value={selectedModelValue}
              onChange={(event) => setSelectedModelValue(event.target.value)}
            >
              {modelOptions.map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Status</label>
            <div className="chip">
              {nkLoading ? "Loading..." : nkCurve ? "Ready" : "No Data"}
            </div>
          </div>
        </div>
        {nkError ? <p className="panel-note">{nkError}</p> : null}
        <div className="plot-pad">
          {nkCurve ? (
            <div className="plot-placeholder plotly-surface" ref={plotRef} />
          ) : (
            <div className="plot-placeholder">Select a material/model to render NK curve.</div>
          )}
        </div>
        {nkCurve ? (
          <div className="inline-actions">
            <button
              className="ghost-button"
              onClick={() => setShowParams((prev) => !prev)}
            >
              {showParams ? "Hide Model Params" : "Show Model Params"}
            </button>
          </div>
        ) : null}
        {showParams && nkCurve?.meta ? (
          <div className="inner-panel model-params">
            <div className="panel-header">
              <h4>Model Parameters</h4>
            </div>
            {nkCurve.meta.modelType === "Cauchy" ? (
              <div className="kv-grid">
                {["A", "B", "C", "D", "E", "F"].map((key) => (
                  <div key={key} className="kv-row">
                    <span className="kv-label">{key}</span>
                    <span className="kv-value">
                      {nkCurve.meta.params?.[key] ?? "-"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="table">
                  <div className="table-row table-head">
                    <div className="table-head-cell">Osc</div>
                    <div className="table-head-cell">Amp</div>
                    <div className="table-head-cell">En</div>
                    <div className="table-head-cell">Eg</div>
                    <div className="table-head-cell">Phi</div>
                    <div className="table-head-cell">Nu</div>
                  </div>
                  {(nkCurve.meta.params?.oscillators || []).map((osc, index) => (
                    <div key={`osc-${index}`} className="table-row">
                      <div className="table-cell">OSC{index + 1}</div>
                      <div className="table-cell">{osc?.amp ?? "-"}</div>
                      <div className="table-cell">{osc?.en ?? "-"}</div>
                      <div className="table-cell">{osc?.eg ?? "-"}</div>
                      <div className="table-cell">{osc?.phi ?? "-"}</div>
                      <div className="table-cell">{osc?.nu ?? "-"}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Upload Your Material</h3>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>Upload Library</label>
            <select
              value={uploadLibrary}
              onChange={(event) => {
                const next = event.target.value;
                setUploadLibrary(next);
              }}
            >
              {libraries.map((lib) => (
                <option key={lib} value={lib}>{lib}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Material Type</label>
            <select
              value={uploadMaterial}
              onChange={(event) => setUploadMaterial(event.target.value)}
            >
              {uploadMaterials.map((material) => (
                <option key={material} value={material}>{material}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>NK Data File</label>
            <input type="file" />
          </div>
          <div className="form-row">
            <label>Convert to HO Model</label>
            <label className="switch">
              <input
                type="checkbox"
                checked={convertToHo}
                onChange={(event) => handleConvertToggle(event.target.checked)}
              />
              <span className="slider" />
            </label>
          </div>
        </div>
        {conversionStatus === "running" && (
          <div className="panel-note">
            Converting NK to HO model... {progress}%
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {conversionReady && (
          <>
            <div className="plot-placeholder">N Curve (Original + HO)</div>
            <div className="plot-placeholder">K Curve (Original + HO)</div>
            <div className="inline-actions">
              <button className="primary-button">Confirm Add to Library</button>
              <button className="ghost-button" onClick={() => handleConvertToggle(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

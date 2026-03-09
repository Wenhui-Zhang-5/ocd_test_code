import React, { useEffect, useMemo, useRef, useState } from "react";

const palette = [
  "#4aa3ff",
  "#ff8a3d",
  "#28d1c6",
  "#ff5f6d",
  "#9b7bff",
  "#7ddc6f"
];

const themeColors = () => {
  const themeRoot = document.body?.dataset?.theme ? document.body : document.documentElement;
  const theme = getComputedStyle(themeRoot);
  const textColor = theme.getPropertyValue("--text").trim() || "#e8eef8";
  const borderColor = theme.getPropertyValue("--border").trim() || "#22324f";
  const panelColor = theme.getPropertyValue("--panel").trim() || "rgba(0,0,0,0)";
  return { textColor, borderColor, panelColor };
};

function PlotSurface({ title, traces, layout, height = 260 }) {
  const plotRef = useRef(null);
  const plotlyRef = useRef(null);
  const [error, setError] = useState("");

  const hasData = Array.isArray(traces) && traces.length > 0;

  useEffect(() => {
    let cancelled = false;
    if (!plotRef.current || !hasData) return undefined;
    const render = async () => {
      try {
        const module = await import("plotly.js-dist-min");
        const Plotly = module.default || module;
        plotlyRef.current = Plotly;
        if (cancelled || !plotRef.current) return;
        const { textColor, borderColor, panelColor } = themeColors();
        const baseLayout = {
          margin: { l: 56, r: 16, t: 28, b: 44 },
          font: { color: textColor, size: 11 },
          xaxis: {
            color: textColor,
            tickfont: { color: textColor },
            linecolor: borderColor,
            gridcolor: borderColor
          },
          yaxis: {
            color: textColor,
            tickfont: { color: textColor },
            linecolor: borderColor,
            gridcolor: borderColor
          },
          legend: { orientation: "h", x: 0, y: 1.15, font: { color: textColor } },
          plot_bgcolor: panelColor || "rgba(0,0,0,0)",
          paper_bgcolor: panelColor || "rgba(0,0,0,0)"
        };
        await Plotly.react(
          plotRef.current,
          traces,
          { ...baseLayout, ...(layout || {}) },
          { responsive: true, displayModeBar: false }
        );
        setError("");
      } catch (err) {
        setError("Failed to render chart.");
      }
    };
    void render();
    return () => {
      cancelled = true;
      if (plotlyRef.current && plotRef.current) {
        try {
          plotlyRef.current.purge(plotRef.current);
        } catch (err) {
          // no-op
        }
      }
    };
  }, [hasData, traces, layout]);

  return (
    <div className="detail-section">
      <div className="detail-section-header">{title}</div>
      {hasData ? (
        <div className="plot-placeholder plotly-surface" style={{ height }}>
          <div className="plotly-container" ref={plotRef} />
        </div>
      ) : (
        <div className="panel-note">No chart data.</div>
      )}
      {error ? <div className="plot-error">{error}</div> : null}
    </div>
  );
}

const toSeriesMap = (obj) => (obj && typeof obj === "object" ? obj : {});

export function SpectrumChart({ spectrumFit, plotData, title = "Baseline vs Simulated" }) {
  const { traces, layout } = useMemo(() => {
    const tracesOut = [];
    let wavelength = [];
    let baselineMap = {};
    let simulatedMap = {};

    if (spectrumFit && typeof spectrumFit === "object") {
      const alignedMeasured = spectrumFit.aligned_measured || {};
      const alignedSimulated = spectrumFit.aligned_simulated || {};
      wavelength = Array.isArray(alignedMeasured.wavelength) ? alignedMeasured.wavelength : [];
      baselineMap = toSeriesMap(alignedMeasured.channels);
      simulatedMap = toSeriesMap(alignedSimulated.channels);
      if (!wavelength.length) {
        wavelength = Array.isArray(spectrumFit.measured?.wavelength) ? spectrumFit.measured.wavelength : [];
        baselineMap = toSeriesMap(spectrumFit.measured?.channels);
        simulatedMap = toSeriesMap(spectrumFit.simulated?.channels);
      }
    }

    if (!wavelength.length && plotData && typeof plotData === "object") {
      wavelength = Array.isArray(plotData.wavelength) ? plotData.wavelength : [];
      baselineMap = toSeriesMap(plotData.baseline);
      simulatedMap = toSeriesMap(plotData.simulated);
    }

    const channels = Array.from(new Set([...Object.keys(baselineMap), ...Object.keys(simulatedMap)]));
    channels.forEach((channel, idx) => {
      const color = palette[idx % palette.length];
      const baselineY = Array.isArray(baselineMap[channel]) ? baselineMap[channel] : [];
      const simulatedY = Array.isArray(simulatedMap[channel]) ? simulatedMap[channel] : [];
      if (baselineY.length === wavelength.length) {
        tracesOut.push({
          x: wavelength,
          y: baselineY,
          type: "scatter",
          mode: "lines",
          name: `${channel} baseline`,
          line: { color, width: 1.5, dash: "dot" }
        });
      }
      if (simulatedY.length === wavelength.length) {
        tracesOut.push({
          x: wavelength,
          y: simulatedY,
          type: "scatter",
          mode: "lines",
          name: `${channel} simulated`,
          line: { color, width: 2 }
        });
      }
    });

    return {
      traces: tracesOut,
      layout: {
        xaxis: { title: "Wavelength (nm)" },
        yaxis: { title: "Signal" }
      }
    };
  }, [plotData, spectrumFit]);

  return <PlotSurface title={title} traces={traces} layout={layout} height={280} />;
}

export function NkChart({ nkSnapshot, title = "NK Parameters" }) {
  const { traces, layout } = useMemo(() => {
    const labels = [];
    const values = [];
    const materials = nkSnapshot?.materials;
    if (materials && typeof materials === "object") {
      Object.keys(materials).forEach((material) => {
        const models = materials[material];
        if (!models || typeof models !== "object") return;
        Object.keys(models).forEach((model) => {
          const params = models[model];
          if (!params || typeof params !== "object") return;
          Object.keys(params).forEach((name) => {
            const value = Number(params[name]);
            if (!Number.isFinite(value)) return;
            labels.push(`${material}.${model}.${name}`);
            values.push(value);
          });
        });
      });
    }
    const tracesOut =
      labels.length > 0
        ? [
            {
              x: labels,
              y: values,
              type: "bar",
              marker: { color: "#4aa3ff" },
              name: "value"
            }
          ]
        : [];
    return {
      traces: tracesOut,
      layout: {
        xaxis: { title: "Parameter" },
        yaxis: { title: "Value" }
      }
    };
  }, [nkSnapshot]);

  return <PlotSurface title={title} traces={traces} layout={layout} height={260} />;
}

export function RegressionChart({ regressionPerCd, title = "Linear Regression (TM vs OCD)" }) {
  const { traces, layout } = useMemo(() => {
    const tracesOut = [];
    const perCd = regressionPerCd && typeof regressionPerCd === "object" ? regressionPerCd : {};
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;
    let idx = 0;
    Object.keys(perCd).forEach((cd) => {
      const row = perCd[cd];
      if (!row || typeof row !== "object") return;
      const tm = Array.isArray(row.tm_values) ? row.tm_values.map(Number).filter(Number.isFinite) : [];
      const ocd = Array.isArray(row.ocd_values) ? row.ocd_values.map(Number).filter(Number.isFinite) : [];
      if (!tm.length || tm.length !== ocd.length) return;
      const color = palette[idx % palette.length];
      idx += 1;
      tm.forEach((v) => {
        minValue = Math.min(minValue, v);
        maxValue = Math.max(maxValue, v);
      });
      ocd.forEach((v) => {
        minValue = Math.min(minValue, v);
        maxValue = Math.max(maxValue, v);
      });
      tracesOut.push({
        x: tm,
        y: ocd,
        type: "scatter",
        mode: "markers",
        name: cd,
        marker: { size: 7, color }
      });
    });

    if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
      tracesOut.push({
        x: [minValue, maxValue],
        y: [minValue, maxValue],
        type: "scatter",
        mode: "lines",
        name: "y = x",
        line: { color: "#ff8a3d", width: 1.5, dash: "dash" }
      });
    }

    return {
      traces: tracesOut,
      layout: {
        xaxis: { title: "TM CD" },
        yaxis: { title: "OCD CD" }
      }
    };
  }, [regressionPerCd]);

  return <PlotSurface title={title} traces={traces} layout={layout} height={280} />;
}


import React, { useMemo, useState } from "react";
import { addTemplateEntry, getWorkspace, loadRecipeSchema } from "../../../data/mockApi.js";

export default function ResultsSummary({ workspaceId }) {
  const [expandedRow, setExpandedRow] = useState(null);
  const [finalVersion, setFinalVersion] = useState("v2");
  const [finalRank, setFinalRank] = useState("1");
  const [templateRank, setTemplateRank] = useState("1");
  const [templateName, setTemplateName] = useState("");
  const [templateComment, setTemplateComment] = useState("");
  const [templateRows, setTemplateRows] = useState([]);

  const results = useMemo(
    () => [
      {
        rank: 1,
        scheme: "CS-A",
        seed: "S2",
        iteration: 12,
        r2: 0.991,
        slope: 1.01,
        sbs: 0.82,
        precision: 0.35,
        pass: true
      },
      {
        rank: 2,
        scheme: "CS-A",
        seed: "S1",
        iteration: 11,
        r2: 0.985,
        slope: 1.02,
        sbs: 0.91,
        precision: 0.42,
        pass: true
      },
      {
        rank: 3,
        scheme: "CS-B",
        seed: "S3",
        iteration: 9,
        r2: 0.972,
        slope: 0.98,
        sbs: 1.12,
        precision: 0.56,
        pass: false
      },
      {
        rank: 4,
        scheme: "CS-B",
        seed: "S4",
        iteration: 8,
        r2: 0.965,
        slope: 0.96,
        sbs: 1.25,
        precision: 0.63,
        pass: false
      }
    ],
    []
  );

  const passingResults = results.filter((item) => item.pass);
  const displayResults = passingResults.length ? passingResults : results.slice(0, 10);
  const versions = ["v1", "v2", "v3"];

  const toggleRow = (rowKey) => {
    setExpandedRow((prev) => (prev === rowKey ? null : rowKey));
  };

  const handleAddTemplate = () => {
    const target = displayResults.find((row) => String(row.rank) === String(templateRank));
    if (!target || !templateName.trim()) return;
    const schema = loadRecipeSchema(workspaceId) || {};
    const workspace = getWorkspace(workspaceId) || {};
    const recipeMeta = {
      recipeName: schema.recipeName || workspace.recipeName || "",
      project: schema.project || workspace.project || "",
      productId: schema.productID || schema.productId || workspace.productId || "",
      owner: schema.owner || workspace.owner || "",
      version: schema.version || workspace.version || "",
      modelId: schema.modelID || workspace.modelID || ""
    };
    const record = addTemplateEntry({
      templateName: templateName.trim(),
      templateComment: templateComment.trim(),
      couplingScheme: target.scheme,
      modelId: recipeMeta.modelId,
      recipeMeta,
      recipeSchemaJson: schema
    });
    setTemplateRows((prev) => [
      ...prev,
      {
        id: record.templateId,
        rank: target.rank,
        scheme: target.scheme,
        seed: target.seed,
        name: templateName.trim(),
        comment: templateComment.trim(),
        recipeName: recipeMeta.recipeName,
        project: recipeMeta.project,
        productId: recipeMeta.productId,
        owner: recipeMeta.owner
      }
    ]);
    setTemplateName("");
    setTemplateComment("");
  };

  const removeTemplateRow = (id) => {
    setTemplateRows((prev) => prev.filter((row) => row.id !== id));
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Results</p>
          <h2>Summary</h2>
          <p className="subtle">Final KPI and best result for {workspaceId}.</p>
        </div>
        <div />
      </header>

      <section className="panel">
        <div className="panel-header">
          <h3>Qualified Ranking</h3>
          <span className="chip">
            {passingResults.length ? "KPI Passed" : "Top 10 (no pass)"}
          </span>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Rank</span>
            <span>Scheme</span>
            <span>Seed</span>
            <span>Iteration</span>
            <span>R2</span>
            <span>Slope</span>
            <span>Side-by-side (nm)</span>
            <span>Precision</span>
            <span></span>
          </div>
          {displayResults.map((row) => (
            <React.Fragment key={`${row.scheme}-${row.seed}-${row.rank}`}>
              <div className="table-row">
                <span>{row.rank}</span>
                <span>{row.scheme}</span>
                <span>{row.seed}</span>
                <span>{row.iteration}</span>
                <span>{row.r2}</span>
                <span>{row.slope}</span>
                <span>{row.sbs}</span>
                <span>{row.precision}</span>
                <button
                  className="ghost-button"
                  onClick={() => toggleRow(`${row.scheme}-${row.seed}-${row.rank}`)}
                >
                  {expandedRow === `${row.scheme}-${row.seed}-${row.rank}` ? "Hide Detail" : "Check Detail"}
                </button>
              </div>
              {expandedRow === `${row.scheme}-${row.seed}-${row.rank}` && (
                <div className="table-row detail-row">
                  <div className="ranking-detail">
                    <div className="detail-grid">
                      <div className="plot-placeholder">NK Curve Placeholder</div>
                      <div className="plot-placeholder">Fitting Curve Placeholder</div>
                      <div className="plot-placeholder">Linear Plot Placeholder</div>
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Final Selection</h3>
          <button className="ghost-button">Download Model JSON</button>
        </div>
        <div className="form-row">
          <label>Ranking</label>
          <select value={finalRank} onChange={(event) => setFinalRank(event.target.value)}>
            {displayResults.map((row) => (
              <option key={`${row.scheme}-${row.seed}-${row.rank}`} value={String(row.rank)}>
                #{row.rank} · {row.scheme} · {row.seed}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Selection for Template</h3>
          <button className="ghost-button" onClick={handleAddTemplate}>Add to Template List</button>
        </div>
        <div className="form-grid two-col">
          <div className="form-row">
            <label>Ranking</label>
            <select value={templateRank} onChange={(event) => setTemplateRank(event.target.value)}>
              {displayResults.map((row) => (
                <option key={`${row.scheme}-${row.seed}-${row.rank}`} value={String(row.rank)}>
                  #{row.rank} · {row.scheme} · {row.seed}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Template Name</label>
            <input
              type="text"
              placeholder="Enter template name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label>Comment</label>
            <input
              type="text"
              placeholder="Optional comment"
              value={templateComment}
              onChange={(event) => setTemplateComment(event.target.value)}
            />
          </div>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Template Name</span>
            <span>Rank</span>
            <span>Scheme</span>
            <span>Recipe Name</span>
            <span>Project</span>
            <span>Product</span>
            <span>Owner</span>
            <span>Comment</span>
            <span></span>
          </div>
          {templateRows.map((row) => (
            <div className="table-row" key={row.id}>
              <span>{row.name}</span>
              <span>{row.rank}</span>
              <span>{row.scheme}</span>
              <span>{row.recipeName || "-"}</span>
              <span>{row.project || "-"}</span>
              <span>{row.productId || "-"}</span>
              <span>{row.owner || "-"}</span>
              <span>{row.comment || "-"}</span>
              <button className="ghost-button" onClick={() => removeTemplateRow(row.id)}>Remove</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

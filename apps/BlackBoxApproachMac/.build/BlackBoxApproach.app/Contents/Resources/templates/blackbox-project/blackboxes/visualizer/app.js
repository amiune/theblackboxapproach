"use strict";

const state = {
  boxEntries: [],
  dataEntries: [],
  systemEntry: null,
  boxes: new Map(),
  dataByKey: new Map(),
  gitChanges: new Map(),
  gitDiffs: new Map(),
  validation: [],
  selectedId: null,
  collapsedIds: new Set(),
  detailMode: "basic",
  appView: "process",
  plotScope: "all",
  plotTransform: { x: 40, y: 40, scale: 1 },
  plotDragging: null,
  dataPlotTransform: { x: 40, y: 40, scale: 1 },
  dataPlotDragging: null,
  loadedFiles: []
};

const dom = {
  processPlotViewButton: document.getElementById("processPlotViewButton"),
  dataPlotViewButton: document.getElementById("dataPlotViewButton"),
  explorerViewButton: document.getElementById("explorerViewButton"),
  explorerWorkspace: document.getElementById("explorerWorkspace"),
  plotWorkspace: document.getElementById("plotWorkspace"),
  dataPlotWorkspace: document.getElementById("dataPlotWorkspace"),
  openFolderButton: document.getElementById("openFolderButton"),
  uploadFolderButton: document.getElementById("uploadFolderButton"),
  uploadFilesButton: document.getElementById("uploadFilesButton"),
  commitChangesButton: document.getElementById("commitChangesButton"),
  discardChangesButton: document.getElementById("discardChangesButton"),
  folderInput: document.getElementById("folderInput"),
  filesInput: document.getElementById("filesInput"),
  loadStatus: document.getElementById("loadStatus"),
  treeCount: document.getElementById("treeCount"),
  treeRoot: document.getElementById("treeRoot"),
  collapseAllButton: document.getElementById("collapseAllButton"),
  expandAllButton: document.getElementById("expandAllButton"),
  globalWarnings: document.getElementById("globalWarnings"),
  detailRoot: document.getElementById("detailRoot"),
  selectedBadge: document.getElementById("selectedBadge"),
  basicViewButton: document.getElementById("basicViewButton"),
  advancedViewButton: document.getElementById("advancedViewButton"),
  instructionInput: document.getElementById("instructionInput"),
  promptOutput: document.getElementById("promptOutput"),
  copyPromptButton: document.getElementById("copyPromptButton"),
  sendPromptButton: document.getElementById("sendPromptButton"),
  plotAllButton: document.getElementById("plotAllButton"),
  plotSelectedButton: document.getElementById("plotSelectedButton"),
  fitPlotButton: document.getElementById("fitPlotButton"),
  plotStatus: document.getElementById("plotStatus"),
  plotSvg: document.getElementById("plotSvg"),
  plotInspector: document.getElementById("plotInspector"),
  fitDataPlotButton: document.getElementById("fitDataPlotButton"),
  dataPlotStatus: document.getElementById("dataPlotStatus"),
  dataPlotSvg: document.getElementById("dataPlotSvg"),
  dataModal: document.getElementById("dataModal"),
  dataModalTitle: document.getElementById("dataModalTitle"),
  dataModalBody: document.getElementById("dataModalBody"),
  closeDataModalButton: document.getElementById("closeDataModalButton"),
  gitModal: document.getElementById("gitModal"),
  gitModalTitle: document.getElementById("gitModalTitle"),
  gitModalBody: document.getElementById("gitModalBody"),
  closeGitModalButton: document.getElementById("closeGitModalButton"),
  chatModal: document.getElementById("chatModal"),
  chatModalTitle: document.getElementById("chatModalTitle"),
  chatModalBody: document.getElementById("chatModalBody"),
  closeChatModalButton: document.getElementById("closeChatModalButton")
};

function init() {
  configureMacBridge();
  dom.processPlotViewButton.addEventListener("click", () => setAppView("process"));
  dom.dataPlotViewButton.addEventListener("click", () => setAppView("data"));
  dom.explorerViewButton.addEventListener("click", () => setAppView("explorer"));
  dom.openFolderButton.disabled = !("showDirectoryPicker" in window);
  dom.openFolderButton.addEventListener("click", openFolder);
  dom.uploadFolderButton.addEventListener("click", () => dom.folderInput.click());
  dom.uploadFilesButton.addEventListener("click", () => dom.filesInput.click());
  dom.commitChangesButton.addEventListener("click", commitChanges);
  dom.discardChangesButton.addEventListener("click", discardChanges);
  dom.folderInput.addEventListener("change", event => readFileList(event.target.files));
  dom.filesInput.addEventListener("change", event => readFileList(event.target.files));
  dom.collapseAllButton.addEventListener("click", collapseAllBoxes);
  dom.expandAllButton.addEventListener("click", expandAllBoxes);
  dom.basicViewButton.addEventListener("click", () => setDetailMode("basic"));
  dom.advancedViewButton.addEventListener("click", () => setDetailMode("advanced"));
  dom.instructionInput.addEventListener("input", updatePrompt);
  dom.copyPromptButton.addEventListener("click", copyPrompt);
  dom.sendPromptButton.addEventListener("click", sendPromptToChatGPT);
  dom.plotAllButton.addEventListener("click", () => setPlotScope("all"));
  dom.plotSelectedButton.addEventListener("click", () => setPlotScope("selected"));
  dom.fitPlotButton.addEventListener("click", fitPlotToView);
  dom.plotSvg.addEventListener("wheel", handlePlotWheel, { passive: false });
  dom.plotSvg.addEventListener("pointerdown", startPlotPan);
  dom.plotSvg.addEventListener("pointermove", movePlotPan);
  dom.plotSvg.addEventListener("pointerup", endPlotPan);
  dom.plotSvg.addEventListener("pointerleave", endPlotPan);
  dom.fitDataPlotButton.addEventListener("click", fitDataPlotToView);
  dom.dataPlotSvg.addEventListener("wheel", handleDataPlotWheel, { passive: false });
  dom.dataPlotSvg.addEventListener("pointerdown", startDataPlotPan);
  dom.dataPlotSvg.addEventListener("pointermove", moveDataPlotPan);
  dom.dataPlotSvg.addEventListener("pointerup", endDataPlotPan);
  dom.dataPlotSvg.addEventListener("pointerleave", endDataPlotPan);
  dom.detailRoot.addEventListener("click", handleDetailClick);
  dom.dataModalBody.addEventListener("click", handleDetailClick);
  dom.plotInspector.addEventListener("click", handleDetailClick);
  dom.chatModalBody.addEventListener("click", handleChatModalClick);
  dom.closeDataModalButton.addEventListener("click", closeDataModal);
  dom.closeGitModalButton.addEventListener("click", closeGitModal);
  dom.closeChatModalButton.addEventListener("click", closeChatModal);
  dom.dataModal.addEventListener("click", event => {
    if (event.target === dom.dataModal) {
      closeDataModal();
    }
  });
  dom.gitModal.addEventListener("click", event => {
    if (event.target === dom.gitModal) {
      closeGitModal();
    }
  });
  dom.chatModal.addEventListener("click", event => {
    if (event.target === dom.chatModal) {
      closeChatModal();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !dom.dataModal.classList.contains("hidden-view")) {
      closeDataModal();
    }
    if (event.key === "Escape" && !dom.gitModal.classList.contains("hidden-view")) {
      closeGitModal();
    }
    if (event.key === "Escape" && !dom.chatModal.classList.contains("hidden-view")) {
      closeChatModal();
    }
  });
  renderAll();
  requestMacProjectSnapshot();
}

function configureMacBridge() {
  if (!hasMacBridge()) {
    return;
  }

  document.body.classList.add("mac-app");
  dom.sendPromptButton.classList.remove("hidden-view");
  dom.commitChangesButton.classList.remove("hidden-view");
  dom.discardChangesButton.classList.remove("hidden-view");
  dom.openFolderButton.classList.add("hidden-view");
  dom.uploadFolderButton.classList.add("hidden-view");
  dom.uploadFilesButton.classList.add("hidden-view");
  window.blackBoxVisualizer = {
    loadProjectSnapshot,
    receiveChatGPTResult,
    receiveChatGPTError,
    receiveGitOperationResult,
    receiveGitOperationError,
    setNativeStatus
  };
}

function hasMacBridge() {
  return Boolean(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.blackboxMac);
}

function postMacMessage(message) {
  if (hasMacBridge()) {
    window.webkit.messageHandlers.blackboxMac.postMessage(message);
  }
}

function requestMacProjectSnapshot() {
  postMacMessage({ type: "requestProjectSnapshot" });
}

function loadProjectSnapshot(payload) {
  const files = Array.isArray(payload && payload.files) ? payload.files : [];
  rebuildProject(files.map(file => ({
    path: normalizePath(file.path),
    name: file.name || basenameWithoutExtension(file.path),
    text: String(file.text || "")
  })));
  renderAll();
  if (payload && payload.status) {
    dom.loadStatus.textContent = payload.status;
  }
}

async function openFolder() {
  if (!("showDirectoryPicker" in window)) {
    return;
  }

  try {
    const handle = await window.showDirectoryPicker();
    const files = [];
    await walkDirectory(handle, handle.name, files);
    await loadFiles(files);
  } catch (error) {
    if (error && error.name !== "AbortError") {
      showLoadError(error.message || String(error));
    }
  }
}

async function walkDirectory(handle, path, files) {
  for await (const [name, child] of handle.entries()) {
    const childPath = `${path}/${name}`;
    if (child.kind === "directory") {
      await walkDirectory(child, childPath, files);
    } else if (isLoadableFile(name)) {
      const file = await child.getFile();
      files.push({ file, path: childPath });
    }
  }
}

async function readFileList(fileList) {
  const files = Array.from(fileList || [])
    .filter(file => isLoadableFile(file.name))
    .map(file => ({
      file,
      path: normalizePath(file.webkitRelativePath || file.name)
    }));

  await loadFiles(files);
}

async function loadFiles(files) {
  const loaded = [];

  for (const item of files) {
    const text = await item.file.text();
    loaded.push({
      path: normalizePath(item.path || item.file.name),
      name: item.file.name,
      text
    });
  }

  rebuildProject(loaded);
  renderAll();
}

function rebuildProject(files) {
  state.boxEntries = [];
  state.dataEntries = [];
  state.systemEntry = null;
  state.boxes = new Map();
  state.dataByKey = new Map();
  state.gitChanges = new Map();
  state.gitDiffs = new Map();
  state.validation = [];
  state.loadedFiles = files;

  for (const file of files) {
    if (isGitStatusFile(file.path)) {
      parseGitStatus(file.text);
      continue;
    }
    if (isGitDiffFile(file.path)) {
      parseGitDiff(file.text);
      continue;
    }

    let parsed = null;
    try {
      parsed = parseYaml(file.text);
    } catch (error) {
      state.validation.push({
        severity: "error",
        message: `Invalid YAML in ${file.path}: ${error.message || String(error)}`
      });
      continue;
    }

    const entry = {
      ...file,
      data: parsed,
      id: parsed.id || basenameWithoutExtension(file.path)
    };

    if (isSystemFile(file.path, parsed)) {
      state.systemEntry = entry;
    } else if (isBoxFile(file.path, parsed)) {
      state.boxEntries.push(entry);
    } else if (isDataFile(file.path, parsed)) {
      state.dataEntries.push(entry);
    }
  }

  indexEntries();
  validateProject();
  collapseAllBoxes(false);

  if (!state.selectedId || !state.boxes.has(state.selectedId)) {
    state.selectedId = getPrimaryRootId() || (state.boxEntries[0] && state.boxEntries[0].id) || null;
  }
}

function indexEntries() {
  const idCounts = new Map();

  for (const entry of state.boxEntries) {
    const id = String(entry.id || "").trim();
    if (!id) {
      state.validation.push({
        severity: "error",
        message: `Box file ${entry.path} is missing id`
      });
      continue;
    }

    idCounts.set(id, (idCounts.get(id) || 0) + 1);
    if (!state.boxes.has(id)) {
      state.boxes.set(id, entry);
    }
  }

  for (const [id, count] of idCounts) {
    if (count > 1) {
      state.validation.push({
        severity: "error",
        message: `Duplicate box id ${id}`
      });
    }
  }

  const dataIdCounts = new Map();

  for (const entry of state.dataEntries) {
    const id = String(entry.id || "").trim();
    if (!id) {
      state.validation.push({
        severity: "error",
        message: `Data file ${entry.path} is missing id`
      });
      continue;
    }

    dataIdCounts.set(id, (dataIdCounts.get(id) || 0) + 1);
    state.dataByKey.set(id.toLowerCase(), entry);
    state.dataByKey.set(basenameWithoutExtension(entry.path).toLowerCase(), entry);
  }

  for (const [id, count] of dataIdCounts) {
    if (count > 1) {
      state.validation.push({
        severity: "error",
        message: `Duplicate data structure id ${id}`
      });
    }
  }
}

function validateProject() {
  const referenced = new Set();
  const childRefsByBox = new Map();

  for (const entry of state.boxEntries) {
    const box = entry.data;
    const children = normalizeStringArray(box.children);
    const calls = extractCalls(box.algorithm);
    childRefsByBox.set(entry.id, unique([...children, ...calls]));

    validateBoxShape(entry);

    for (const child of children) {
      referenced.add(child);
      if (!state.boxes.has(child)) {
        state.validation.push({
          severity: "error",
          boxId: entry.id,
          message: `${entry.id} lists missing child ${child}`
        });
      }
    }

    for (const call of calls) {
      referenced.add(call);
      if (!children.includes(call)) {
        state.validation.push({
          severity: "warning",
          boxId: entry.id,
          message: `${entry.id} CALLs ${call} but does not list it in children`
        });
      }
      if (!state.boxes.has(call)) {
        state.validation.push({
          severity: "error",
          boxId: entry.id,
          message: `${entry.id} CALLs missing box ${call}`
        });
      }
    }

    for (const child of children) {
      if (!calls.includes(child) && state.boxes.has(child)) {
        state.validation.push({
          severity: "warning",
          boxId: entry.id,
          message: `${entry.id} lists child ${child} but does not CALL it`
        });
      }
    }

    for (const dataRef of getDataRefs(box)) {
      if (!resolveDataRef(dataRef)) {
        state.validation.push({
          severity: "error",
          boxId: entry.id,
          message: `${entry.id} references missing data structure ${dataRef}`
        });
      }
    }

    if (hasInlineFields(box.signature)) {
      state.validation.push({
        severity: "error",
        boxId: entry.id,
        message: `${entry.id} duplicates data structure fields inside its signature`
      });
    }
  }

  const primaryRoot = getPrimaryRootId();
  if (primaryRoot && state.boxes.has(primaryRoot)) {
    const reachable = collectReachable(primaryRoot, childRefsByBox);
    for (const entry of state.boxEntries) {
      if (!reachable.has(entry.id)) {
        state.validation.push({
          severity: "warning",
          boxId: entry.id,
          message: `${entry.id} is not reachable from root ${primaryRoot}`
        });
      }
    }
  } else {
    for (const entry of state.boxEntries) {
      if (!referenced.has(entry.id)) {
        const roots = state.boxEntries.filter(candidate => !referenced.has(candidate.id));
        if (roots.length > 1) {
          state.validation.push({
            severity: "warning",
            boxId: entry.id,
            message: `${entry.id} is an unreferenced root or orphan`
          });
        }
      }
    }
  }

  for (const cycle of findCycles(childRefsByBox)) {
    state.validation.push({
      severity: "error",
      message: `Circular reference detected: ${cycle.join(" -> ")}`
    });
  }
}

function validateBoxShape(entry) {
  const box = entry.data;
  const required = ["id", "name", "kind", "box_type", "state", "provenance", "intent", "algorithm", "children"];

  for (const field of required) {
    if (box[field] === undefined || box[field] === null || box[field] === "") {
      state.validation.push({
        severity: "warning",
        boxId: entry.id,
        message: `${entry.id} is missing ${field}`
      });
    }
  }

  if (box.kind && box.kind !== "black_box") {
    state.validation.push({
      severity: "warning",
      boxId: entry.id,
      message: `${entry.id} kind should be black_box`
    });
  }

  if (box.box_type === "view" && !String(box.visual_design || "").trim()) {
    state.validation.push({
      severity: "error",
      boxId: entry.id,
      message: `${entry.id} is a view box without visual_design`
    });
  }

  if (box.provenance === "ai_defined" && !String(box.ai_reasoning || "").trim()) {
    state.validation.push({
      severity: "warning",
      boxId: entry.id,
      message: `${entry.id} is ai_defined without ai_reasoning`
    });
  }

  if (!getChildrenAndCalls(box).length && !String(box.implementation && box.implementation.code || "").trim()) {
    state.validation.push({
      severity: "warning",
      boxId: entry.id,
      message: `${entry.id} is a leaf box without executable implementation.code`
    });
  }
}

function renderAll() {
  renderAppView();
  renderStatus();
  renderGitActions();
  renderTree();
  renderWarnings();
  renderDetails();
  renderPlot();
  renderDataPlot();
  updatePrompt();
}

function renderGitActions() {
  const dirty = hasPendingGitChanges();
  dom.commitChangesButton.disabled = !dirty;
  dom.discardChangesButton.disabled = !dirty;
}

function renderAppView() {
  const processActive = state.appView === "process";
  const dataActive = state.appView === "data";
  const explorerActive = state.appView === "explorer";
  dom.plotWorkspace.classList.toggle("hidden-view", !processActive);
  dom.dataPlotWorkspace.classList.toggle("hidden-view", !dataActive);
  dom.explorerWorkspace.classList.toggle("hidden-view", !explorerActive);
  dom.processPlotViewButton.classList.toggle("active", processActive);
  dom.dataPlotViewButton.classList.toggle("active", dataActive);
  dom.explorerViewButton.classList.toggle("active", explorerActive);
}

function setAppView(view) {
  state.appView = view === "data" ? "data" : view === "explorer" ? "explorer" : "process";
  renderAppView();
  if (state.appView === "process") {
    renderPlot();
  } else if (state.appView === "data") {
    renderDataPlot();
  }
}

function renderPlot() {
  dom.plotSvg.innerHTML = "";
  dom.plotAllButton.classList.toggle("active", state.plotScope === "all");
  dom.plotSelectedButton.classList.toggle("active", state.plotScope === "selected");

  if (!state.boxEntries.length) {
    dom.plotSvg.appendChild(svgText(40, 48, "Load the blackboxes folder or YAML files.", "plot-node-meta"));
    dom.plotInspector.className = "plot-inspector empty-state";
    dom.plotInspector.textContent = "Select a node in the plot.";
    return;
  }

  const layout = buildPlotLayout();
  state.plotBounds = layout.bounds;
  dom.plotStatus.textContent = `${layout.nodes.length} node${layout.nodes.length === 1 ? "" : "s"}`;

  const viewport = svgEl("g", {
    class: "plot-viewport",
    transform: plotTransformValue()
  });

  for (const link of layout.links) {
    viewport.appendChild(svgEl("path", {
      class: "plot-link",
      d: curvedPath(link.source.x + 80, link.source.y + 58, link.target.x + 80, link.target.y)
    }));
  }

  for (const node of layout.nodes) {
    viewport.appendChild(renderPlotNode(node));
  }

  dom.plotSvg.appendChild(viewport);
  renderPlotInspector();
}

function renderPlotNode(node) {
  const entry = state.boxes.get(node.id);
  const box = entry ? entry.data : {};
  const gitChange = entry ? getGitChangeForPath(entry.path) : null;
  const group = svgEl("g", {
    class: `plot-node${state.selectedId === node.id ? " selected" : ""}${gitChange ? ` git-changed ${gitClass(gitChange.status)}` : ""}`,
    transform: `translate(${node.x}, ${node.y})`,
    tabindex: "0"
  });

  group.appendChild(svgEl("rect", {
    class: "plot-node-card",
    width: 160,
    height: 58,
    rx: 8,
    ry: 8
  }));
  group.appendChild(svgEl("circle", {
    class: "plot-node-dot",
    cx: 16,
    cy: 19,
    r: 6,
    fill: plotColor(box.box_type)
  }));
  group.appendChild(svgText(30, 21, node.id, "plot-node-title"));
  group.appendChild(svgText(30, 41, `${box.box_type || "box"} / ${formatProvenance(box.provenance)}`, "plot-node-meta"));
  group.addEventListener("click", event => {
    event.stopPropagation();
    selectBox(node.id);
    renderPlotInspector();
  });
  group.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectBox(node.id);
      renderPlotInspector();
    }
  });
  return group;
}

function renderPlotInspector() {
  const entry = state.selectedId ? state.boxes.get(state.selectedId) : null;
  if (!entry) {
    dom.plotInspector.className = "plot-inspector empty-state";
    dom.plotInspector.textContent = "Select a node in the plot.";
    return;
  }

  const box = entry.data;
  dom.plotInspector.className = "plot-inspector";
  dom.plotInspector.innerHTML = [
    `<h3>${escapeHtml(box.name || entry.id)}</h3>`,
    `<p>${badge(box.box_type)} ${badge(box.state)} ${badge(box.provenance)}</p>`,
    `<p><strong>ID</strong><br>${escapeHtml(entry.id)}</p>`,
    gitChangeSection(entry.path),
    `<section class="plot-inspector-section"><h4>Intent</h4><p>${escapeHtml(box.intent || "No intent recorded.")}</p></section>`,
    `<section class="plot-inspector-section"><h4>Algorithm</h4><pre>${escapeHtml(box.algorithm || "No algorithm recorded.")}</pre></section>`,
    `<button id="openPlotNodeButton" type="button">Open Details</button>`
  ].join("");

  document.getElementById("openPlotNodeButton").addEventListener("click", () => {
    openNodeInExplorer(entry.id);
  });
}

function openNodeInExplorer(id) {
  state.selectedId = id;
  state.detailMode = "advanced";
  setAppView("explorer");
  renderTree();
  renderDetails();
  updatePrompt();
}

function renderDataPlot() {
  dom.dataPlotSvg.innerHTML = "";

  if (!state.dataEntries.length) {
    dom.dataPlotSvg.appendChild(svgText(40, 48, "Load data structure YAML files.", "plot-node-meta"));
    dom.dataPlotStatus.textContent = "0 structures";
    return;
  }

  const layout = buildDataPlotLayout();
  state.dataPlotBounds = layout.bounds;
  dom.dataPlotStatus.textContent = `${layout.nodes.length} structure${layout.nodes.length === 1 ? "" : "s"}`;

  const viewport = svgEl("g", {
    class: "data-plot-viewport",
    transform: dataPlotTransformValue()
  });

  for (const link of layout.links) {
    viewport.appendChild(svgEl("path", {
      class: "plot-link data-relation-link",
      d: dataRelationPath(link.source.x + link.source.width, link.source.y + 34, link.target.x, link.target.y + 34)
    }));
  }

  for (const node of layout.nodes) {
    viewport.appendChild(renderDataPlotNode(node));
  }

  dom.dataPlotSvg.appendChild(viewport);
}

function renderDataPlotNode(node) {
  const gitChange = getGitChangeForPath(node.path);
  const group = svgEl("g", {
    class: "data-entity-node",
    transform: `translate(${node.x}, ${node.y})`,
    tabindex: "0"
  });

  group.appendChild(svgEl("rect", {
    class: `data-entity-card${gitChange ? ` git-changed ${gitClass(gitChange.status)}` : ""}`,
    width: node.width,
    height: node.height,
    rx: 8,
    ry: 8
  }));
  group.appendChild(svgEl("rect", {
    class: "data-entity-header",
    width: node.width,
    height: 34,
    rx: 8,
    ry: 8
  }));
  group.appendChild(svgText(12, 22, node.id, "data-entity-title"));

  node.fields.forEach((field, index) => {
    const y = 56 + index * 24;
    group.appendChild(svgText(12, y, field.name, "data-field-name"));
    group.appendChild(svgText(118, y, field.type, "data-field-type"));
  });

  group.addEventListener("click", () => openDataModal(node.path));
  group.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDataModal(node.path);
    }
  });
  return group;
}

function buildDataPlotLayout() {
  const columns = Math.max(1, Math.ceil(Math.sqrt(state.dataEntries.length)));
  const cardWidth = 250;
  const xGap = 310;
  const yGap = 72;
  const columnHeights = Array(columns).fill(0);
  const nodes = [];
  const nodeById = new Map();

  state.dataEntries.forEach((entry, index) => {
    const fields = normalizeArray(entry.data.fields).map(field => ({
      name: String(field.name || ""),
      type: String(field.type || "")
    }));
    const height = Math.max(86, 52 + fields.length * 24);
    const column = index % columns;
    const node = {
      id: entry.data.id || basenameWithoutExtension(entry.path),
      path: entry.path,
      fields,
      width: cardWidth,
      height,
      x: column * xGap,
      y: columnHeights[column]
    };
    columnHeights[column] += height + yGap;
    nodes.push(node);
    nodeById.set(node.id.toLowerCase(), node);
  });

  const links = [];
  for (const source of nodes) {
    for (const field of source.fields) {
      const target = nodeById.get(cleanTypeName(field.type).toLowerCase());
      if (target && target !== source) {
        links.push({ source, target, field: field.name });
      }
    }
  }

  const xs = nodes.map(node => node.x);
  const ys = nodes.map(node => node.y);
  return {
    nodes,
    links,
    bounds: {
      minX: Math.min(...xs, 0),
      minY: Math.min(...ys, 0),
      maxX: Math.max(...nodes.map(node => node.x + node.width), 0),
      maxY: Math.max(...nodes.map(node => node.y + node.height), 0)
    }
  };
}

function cleanTypeName(type) {
  return String(type || "")
    .replace(/\[\]/g, "")
    .replace(/[?]/g, "")
    .trim();
}

function dataRelationPath(x1, y1, x2, y2) {
  const direction = x2 >= x1 ? 1 : -1;
  const handle = Math.max(Math.abs(x2 - x1) / 2, 50);
  return `M ${x1} ${y1} C ${x1 + handle * direction} ${y1}, ${x2 - handle * direction} ${y2}, ${x2} ${y2}`;
}

function fitDataPlotToView() {
  if (!state.dataEntries.length) {
    return;
  }

  const bounds = buildDataPlotLayout().bounds;
  const width = dom.dataPlotSvg.clientWidth || 900;
  const height = dom.dataPlotSvg.clientHeight || 600;
  const plotWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const plotHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((width - 80) / plotWidth, (height - 80) / plotHeight, 1.4);
  const safeScale = Math.max(scale, 0.25);

  state.dataPlotTransform = {
    scale: safeScale,
    x: (width - plotWidth * safeScale) / 2 - bounds.minX * safeScale,
    y: (height - plotHeight * safeScale) / 2 - bounds.minY * safeScale
  };
  renderDataPlot();
}

function setPlotScope(scope) {
  state.plotScope = scope === "selected" ? "selected" : "all";
  if (state.plotScope === "selected") {
    fitPlotToView();
  } else {
    renderPlot();
  }
}

function buildPlotLayout() {
  if (state.plotScope === "selected" && state.selectedId && state.boxes.has(state.selectedId)) {
    return buildSelectedPlotLayout(state.selectedId);
  }

  const roots = getRootIds();
  const nodes = [];
  const links = [];
  let cursor = 0;
  const xGap = 210;
  const yGap = 112;

  function visit(id, depth, ancestors) {
    const entry = state.boxes.get(id);
    const children = entry
      ? getChildrenAndCalls(entry.data).filter(child => state.boxes.has(child) && !ancestors.has(child))
      : [];
    const childNodes = [];
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);

    for (const child of children) {
      childNodes.push(visit(child, depth + 1, nextAncestors));
    }

    const x = childNodes.length
      ? (childNodes[0].x + childNodes[childNodes.length - 1].x) / 2
      : cursor++ * xGap;
    const node = { id, x, y: depth * yGap };
    nodes.push(node);

    for (const childNode of childNodes) {
      links.push({ source: node, target: childNode });
    }

    return node;
  }

  for (const root of roots) {
    visit(root, 0, new Set());
    cursor += 0.7;
  }

  const xs = nodes.map(node => node.x);
  const ys = nodes.map(node => node.y);
  return {
    nodes,
    links,
    bounds: {
      minX: Math.min(...xs, 0),
      minY: Math.min(...ys, 0),
      maxX: Math.max(...xs, 0) + 160,
      maxY: Math.max(...ys, 0) + 58
    }
  };
}

function buildSelectedPlotLayout(selectedId) {
  const parentIds = getParentIds(selectedId);
  const childIds = getChildrenAndCalls(state.boxes.get(selectedId).data)
    .filter(child => state.boxes.has(child));
  const nodes = [];
  const links = [];
  const xGap = 210;
  const yGap = 112;
  const middleX = Math.max((Math.max(parentIds.length, childIds.length, 1) - 1) * xGap / 2, 0);
  const selectedNode = { id: selectedId, x: middleX, y: yGap };

  parentIds.forEach((id, index) => {
    const node = { id, x: spreadX(index, parentIds.length, middleX, xGap), y: 0 };
    nodes.push(node);
    links.push({ source: node, target: selectedNode });
  });

  nodes.push(selectedNode);

  childIds.forEach((id, index) => {
    const node = { id, x: spreadX(index, childIds.length, middleX, xGap), y: yGap * 2 };
    nodes.push(node);
    links.push({ source: selectedNode, target: node });
  });

  const xs = nodes.map(node => node.x);
  const ys = nodes.map(node => node.y);
  return {
    nodes,
    links,
    bounds: {
      minX: Math.min(...xs, 0),
      minY: Math.min(...ys, 0),
      maxX: Math.max(...xs, 0) + 160,
      maxY: Math.max(...ys, 0) + 58
    }
  };
}

function getParentIds(id) {
  return state.boxEntries
    .filter(entry => getChildrenAndCalls(entry.data).includes(id))
    .map(entry => entry.id);
}

function spreadX(index, count, middleX, gap) {
  if (count <= 1) {
    return middleX;
  }
  return middleX - ((count - 1) * gap / 2) + index * gap;
}

function getRootIds() {
  const refs = new Set();
  for (const entry of state.boxEntries) {
    for (const child of getChildrenAndCalls(entry.data)) {
      refs.add(child);
    }
  }

  const primaryRoot = getPrimaryRootId();
  const roots = [];
  if (primaryRoot && state.boxes.has(primaryRoot)) {
    roots.push(primaryRoot);
  }

  for (const entry of state.boxEntries) {
    if (!refs.has(entry.id) && !roots.includes(entry.id)) {
      roots.push(entry.id);
    }
  }

  if (!roots.length && state.boxEntries[0]) {
    roots.push(state.boxEntries[0].id);
  }

  return roots;
}

function fitPlotToView() {
  if (!state.boxEntries.length) {
    return;
  }

  const bounds = buildPlotLayout().bounds;
  const width = dom.plotSvg.clientWidth || 900;
  const height = dom.plotSvg.clientHeight || 600;
  const plotWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const plotHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((width - 80) / plotWidth, (height - 80) / plotHeight, 1.6);
  const safeScale = Math.max(scale, 0.25);

  state.plotTransform = {
    scale: safeScale,
    x: (width - plotWidth * safeScale) / 2 - bounds.minX * safeScale,
    y: (height - plotHeight * safeScale) / 2 - bounds.minY * safeScale
  };
  renderPlot();
}

function handlePlotWheel(event) {
  if (!state.boxEntries.length) {
    return;
  }

  event.preventDefault();
  const rect = dom.plotSvg.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const nextScale = clamp(state.plotTransform.scale * (event.deltaY < 0 ? 1.1 : 0.9), 0.25, 2.5);
  const ratio = nextScale / state.plotTransform.scale;

  state.plotTransform = {
    scale: nextScale,
    x: pointerX - (pointerX - state.plotTransform.x) * ratio,
    y: pointerY - (pointerY - state.plotTransform.y) * ratio
  };
  applyPlotTransform();
}

function handleDataPlotWheel(event) {
  if (!state.dataEntries.length) {
    return;
  }

  event.preventDefault();
  const rect = dom.dataPlotSvg.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const nextScale = clamp(state.dataPlotTransform.scale * (event.deltaY < 0 ? 1.1 : 0.9), 0.25, 2.5);
  const ratio = nextScale / state.dataPlotTransform.scale;

  state.dataPlotTransform = {
    scale: nextScale,
    x: pointerX - (pointerX - state.dataPlotTransform.x) * ratio,
    y: pointerY - (pointerY - state.dataPlotTransform.y) * ratio
  };
  applyDataPlotTransform();
}

function startPlotPan(event) {
  if (event.target.closest && event.target.closest(".plot-node")) {
    return;
  }
  state.plotDragging = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: state.plotTransform.x,
    originY: state.plotTransform.y
  };
  if (dom.plotSvg.setPointerCapture) {
    dom.plotSvg.setPointerCapture(event.pointerId);
  }
}

function movePlotPan(event) {
  if (!state.plotDragging || state.plotDragging.pointerId !== event.pointerId) {
    return;
  }

  state.plotTransform.x = state.plotDragging.originX + event.clientX - state.plotDragging.startX;
  state.plotTransform.y = state.plotDragging.originY + event.clientY - state.plotDragging.startY;
  applyPlotTransform();
}

function endPlotPan(event) {
  if (!state.plotDragging || state.plotDragging.pointerId !== event.pointerId) {
    return;
  }
  state.plotDragging = null;
  if (dom.plotSvg.releasePointerCapture) {
    dom.plotSvg.releasePointerCapture(event.pointerId);
  }
}

function startDataPlotPan(event) {
  if (event.target.closest && event.target.closest(".data-entity-node")) {
    return;
  }
  state.dataPlotDragging = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: state.dataPlotTransform.x,
    originY: state.dataPlotTransform.y
  };
  if (dom.dataPlotSvg.setPointerCapture) {
    dom.dataPlotSvg.setPointerCapture(event.pointerId);
  }
}

function moveDataPlotPan(event) {
  if (!state.dataPlotDragging || state.dataPlotDragging.pointerId !== event.pointerId) {
    return;
  }

  state.dataPlotTransform.x = state.dataPlotDragging.originX + event.clientX - state.dataPlotDragging.startX;
  state.dataPlotTransform.y = state.dataPlotDragging.originY + event.clientY - state.dataPlotDragging.startY;
  applyDataPlotTransform();
}

function endDataPlotPan(event) {
  if (!state.dataPlotDragging || state.dataPlotDragging.pointerId !== event.pointerId) {
    return;
  }
  state.dataPlotDragging = null;
  if (dom.dataPlotSvg.releasePointerCapture) {
    dom.dataPlotSvg.releasePointerCapture(event.pointerId);
  }
}

function applyPlotTransform() {
  const viewport = dom.plotSvg.querySelector(".plot-viewport");
  if (viewport) {
    viewport.setAttribute("transform", plotTransformValue());
  }
}

function applyDataPlotTransform() {
  const viewport = dom.dataPlotSvg.querySelector(".data-plot-viewport");
  if (viewport) {
    viewport.setAttribute("transform", dataPlotTransformValue());
  }
}

function plotTransformValue() {
  return `translate(${state.plotTransform.x}, ${state.plotTransform.y}) scale(${state.plotTransform.scale})`;
}

function dataPlotTransformValue() {
  return `translate(${state.dataPlotTransform.x}, ${state.dataPlotTransform.y}) scale(${state.dataPlotTransform.scale})`;
}

function curvedPath(x1, y1, x2, y2) {
  const mid = y1 + Math.max((y2 - y1) / 2, 28);
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

function plotColor(type) {
  if (type === "view") {
    return "#5b6472";
  }
  if (type === "service" || type === "integration") {
    return "#b35c00";
  }
  if (type === "data_flow") {
    return "#0e7490";
  }
  return "#0f766e";
}

function svgEl(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function svgText(x, y, text, className) {
  const element = svgEl("text", { x, y, class: className });
  element.textContent = text;
  return element;
}

function renderStatus() {
  const fileCount = state.loadedFiles.length;
  const boxCount = state.boxEntries.length;
  const dataCount = state.dataEntries.length;
  const issueCount = state.validation.length;

  dom.loadStatus.textContent = fileCount
    ? `${fileCount} files loaded, ${boxCount} boxes, ${dataCount} data structures, ${issueCount} issues`
    : "No files loaded";
  dom.treeCount.textContent = String(boxCount);
  if (!state.boxEntries.length) {
    dom.plotStatus.textContent = "0 nodes";
  }
  if (!state.dataEntries.length) {
    dom.dataPlotStatus.textContent = "0 structures";
  }
  dom.collapseAllButton.disabled = !boxCount;
  dom.expandAllButton.disabled = !boxCount;
  dom.plotAllButton.disabled = !boxCount;
  dom.plotSelectedButton.disabled = !boxCount;
  dom.fitPlotButton.disabled = !boxCount;
  dom.fitDataPlotButton.disabled = !dataCount;
}

function renderTree() {
  dom.treeRoot.innerHTML = "";

  if (!state.boxEntries.length) {
    dom.treeRoot.innerHTML = '<p class="empty-state">Load the blackboxes folder or YAML files.</p>';
    return;
  }

  const refs = new Set();
  for (const entry of state.boxEntries) {
    for (const child of getChildrenAndCalls(entry.data)) {
      refs.add(child);
    }
  }

  const primaryRoot = getPrimaryRootId();
  const roots = [];
  if (primaryRoot && state.boxes.has(primaryRoot)) {
    roots.push(primaryRoot);
  }

  for (const entry of state.boxEntries) {
    if (!refs.has(entry.id) && !roots.includes(entry.id)) {
      roots.push(entry.id);
    }
  }

  if (!roots.length && state.boxEntries[0]) {
    roots.push(state.boxEntries[0].id);
  }

  const rootList = document.createElement("ul");
  rootList.className = "tree-group root";

  for (const root of roots) {
    rootList.appendChild(renderTreeNode(root, new Set()));
  }

  dom.treeRoot.appendChild(rootList);
}

function renderTreeNode(id, ancestors) {
  const item = document.createElement("li");
  item.className = "tree-node";
  const entry = state.boxes.get(id);

  if (!entry) {
    const missing = document.createElement("div");
    missing.className = "tree-button missing-node";
    missing.innerHTML = `<span class="tree-name">${escapeHtml(id)}</span><span class="badge">missing</span>`;
    item.appendChild(missing);
    return item;
  }

  const children = getChildrenAndCalls(entry.data);
  const hasChildren = children.length > 0;
  const isCollapsed = state.collapsedIds.has(id);
  const gitChange = getGitChangeForPath(entry.path);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-button${state.selectedId === id ? " selected" : ""}${gitChange ? ` git-changed ${gitClass(gitChange.status)}` : ""}`;
  button.innerHTML = [
    `<span class="tree-toggle ${hasChildren ? "" : "placeholder"}" title="${hasChildren ? "Toggle children" : ""}">${hasChildren ? (isCollapsed ? "+" : "-") : ""}</span>`,
    `<span class="tree-name" title="${escapeHtml(id)}">${escapeHtml(id)}</span>`,
    `<span class="badge ${escapeClass(entry.data.box_type)}">${escapeHtml(entry.data.box_type || "box")}</span>`,
    `<span class="badge ${escapeClass(entry.data.provenance)}">${formatProvenance(entry.data.provenance)}</span>`,
    gitChange ? `<span class="badge git-badge ${gitClass(gitChange.status)}">${escapeHtml(gitChange.label)}</span>` : ""
  ].join("");
  button.addEventListener("click", event => {
    if (event.target && event.target.classList.contains("tree-toggle") && hasChildren) {
      toggleTreeNode(id);
      return;
    }
    selectBox(id);
  });
  item.appendChild(button);

  if (ancestors.has(id)) {
    const cycleNote = document.createElement("ul");
    cycleNote.className = "tree-group";
    cycleNote.innerHTML = '<li class="tree-node missing-node">cycle</li>';
    item.appendChild(cycleNote);
    return item;
  }

  if (hasChildren && !isCollapsed) {
    const childList = document.createElement("ul");
    childList.className = "tree-group";
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);

    for (const child of children) {
      childList.appendChild(renderTreeNode(child, nextAncestors));
    }
    item.appendChild(childList);
  }

  return item;
}

function toggleTreeNode(id) {
  if (state.collapsedIds.has(id)) {
    state.collapsedIds.delete(id);
  } else {
    state.collapsedIds.add(id);
  }
  renderTree();
}

function collapseAllBoxes(shouldRender = true) {
  state.collapsedIds = new Set(
    state.boxEntries
      .filter(entry => getChildrenAndCalls(entry.data).length)
      .map(entry => entry.id)
  );
  if (shouldRender) {
    renderTree();
  }
}

function expandAllBoxes() {
  state.collapsedIds = new Set();
  renderTree();
}

function selectBox(id) {
  state.selectedId = id;
  renderTree();
  renderDetails();
  if (state.appView === "process" && state.plotScope === "selected") {
    fitPlotToView();
  } else {
    renderPlot();
  }
  updatePrompt();
}

function renderWarnings() {
  if (!state.validation.length) {
    dom.globalWarnings.innerHTML = '<p class="empty-state">No validation warnings.</p>';
    return;
  }

  dom.globalWarnings.innerHTML = state.validation
    .map(issue => {
      const className = issue.severity === "error" ? "warning-item error" : "warning-item";
      return `<p class="${className}">${escapeHtml(issue.message)}</p>`;
    })
    .join("");
}

function renderDetails() {
  const entry = state.selectedId ? state.boxes.get(state.selectedId) : null;

  if (!entry) {
    dom.selectedBadge.textContent = "None";
    dom.detailRoot.className = "detail-root empty-state";
    dom.detailRoot.textContent = state.boxEntries.length ? "Select a box from the tree." : "Load YAML files to inspect boxes.";
    return;
  }

  const box = entry.data;
  const issues = state.validation.filter(issue => issue.boxId === entry.id);
  const isAdvanced = state.detailMode === "advanced";
  dom.selectedBadge.textContent = entry.id;
  dom.basicViewButton.classList.toggle("active", !isAdvanced);
  dom.advancedViewButton.classList.toggle("active", isAdvanced);
  dom.detailRoot.className = "detail-root";
  const basicSections = [
    detailSection("Human Summary", box.human_summary),
    detailSection("AI Reasoning", box.ai_reasoning),
    detailSection("Intent", box.intent),
    detailSection("Algorithm", box.algorithm, true)
  ];
  const advancedSections = [
    detailSection("ID", entry.id),
    detailSection("Path", entry.path),
    gitChangeSection(entry.path),
    referencedDataSection(box),
    detailSection("Human Summary", box.human_summary),
    detailSection("AI Reasoning", box.ai_reasoning),
    detailSection("Intent", box.intent),
    detailSection("Algorithm", box.algorithm, true),
    detailSection("Signature", box.signature ? toYaml(box.signature) : "", true),
    detailSection("Contracts", box.contracts ? toYaml(box.contracts) : "", true),
    detailSection("Implementation Code", box.implementation && box.implementation.code ? box.implementation.code : "", true),
    detailSection("Implementation", box.implementation ? toYaml(implementationSummary(box.implementation)) : "", true),
    detailSection("Children", getChildrenAndCalls(box).join("\n"))
  ];

  dom.detailRoot.innerHTML = (isAdvanced ? advancedSections : basicSections).join("");
}

function setDetailMode(mode) {
  state.detailMode = mode === "advanced" ? "advanced" : "basic";
  renderDetails();
}

function detailSection(title, value, code) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }

  const content = code
    ? `<pre>${escapeHtml(String(value))}</pre>`
    : `<p>${escapeHtml(String(value))}</p>`;
  return `<section class="detail-section"><h4>${escapeHtml(title)}</h4>${content}</section>`;
}

function implementationSummary(implementation) {
  const summary = { ...implementation };
  if (summary.code) {
    summary.code = "[shown in Implementation Code]";
  }
  return summary;
}

function referencedDataSection(box) {
  const groups = getDataRefsByDirection(box);
  if (!groups.inputs.length && !groups.outputs.length) {
    return "";
  }

  const renderGroup = (label, refs) => {
    if (!refs.length) {
      return "";
    }
    const items = refs.map(ref => dataRefButton(ref)).join("");
    return `<div class="data-ref-group"><span class="data-ref-label">${escapeHtml(label)}</span><div class="data-ref-list">${items}</div></div>`;
  };

  return [
    '<section class="detail-section"><h4>Referenced Data</h4>',
    renderGroup("Inputs", groups.inputs),
    renderGroup("Outputs", groups.outputs),
    "</section>"
  ].join("");
}

function dataRefButton(ref) {
    const entry = resolveDataRef(ref);
    const name = entry && entry.data && entry.data.id ? entry.data.id : basenameWithoutExtension(ref);
    const path = entry ? entry.path : "";
    const disabled = entry ? "" : " disabled";
    return `<button class="data-ref-button" type="button" data-data-path="${escapeHtml(path)}"${disabled}>${escapeHtml(name)}</button>`;
}

function handleDetailClick(event) {
  const button = event.target.closest && event.target.closest(".data-ref-button");
  if (button && !button.disabled) {
    openDataModal(button.getAttribute("data-data-path"));
    return;
  }
  const gitButton = event.target.closest && event.target.closest(".git-change-button");
  if (gitButton && !gitButton.disabled) {
    openGitModal(gitButton.getAttribute("data-git-path"));
  }
}

function openDataModal(path) {
  const entry = state.dataEntries.find(candidate => candidate.path === path);
  if (!entry) {
    return;
  }

  const title = entry.data && entry.data.id ? entry.data.id : basenameWithoutExtension(entry.path);
  dom.dataModalTitle.textContent = title;
  dom.dataModalBody.innerHTML = [
    `<p class="modal-path">${escapeHtml(entry.path)}</p>`,
    gitChangeSection(entry.path),
    `<pre>${escapeHtml(entry.text.trim())}</pre>`
  ].join("");
  dom.dataModal.classList.remove("hidden-view");
  dom.closeDataModalButton.focus();
}

function closeDataModal() {
  dom.dataModal.classList.add("hidden-view");
}

function gitChangeSection(path) {
  const change = getGitChangeForPath(path);
  if (!change) {
    return "";
  }

  return [
    '<section class="detail-section git-change-section">',
    "<h4>Working Copy Change</h4>",
    `<p><span class="badge git-badge ${gitClass(change.status)}">${escapeHtml(change.label)}</span> ${escapeHtml(path)}</p>`,
    `<button class="git-change-button" type="button" data-git-path="${escapeHtml(path)}">View Git Changes</button>`,
    "</section>"
  ].join("");
}

function openGitModal(path) {
  const change = getGitChangeForPath(path);
  if (!change) {
    return;
  }

  const diff = state.gitDiffs.get(normalizeGitPath(path)) || "No unified diff was loaded for this path.";
  dom.gitModalTitle.textContent = `Git Changes: ${basenameWithoutExtension(path)}`;
  dom.gitModalBody.innerHTML = [
    `<p class="modal-path">${escapeHtml(path)}</p>`,
    `<p><span class="badge git-badge ${gitClass(change.status)}">${escapeHtml(change.label)}</span></p>`,
    renderDiff(diff)
  ].join("");
  dom.gitModal.classList.remove("hidden-view");
  dom.closeGitModalButton.focus();
}

function closeGitModal() {
  dom.gitModal.classList.add("hidden-view");
}

function renderDiff(diff) {
  const text = String(diff || "").trim();
  if (!text) {
    return '<div class="diff-view"><div class="diff-line diff-context">No diff loaded.</div></div>';
  }

  const rows = text.split("\n").map(line => {
    let className = "diff-line diff-context";
    if (line.startsWith("diff --git") || line.startsWith("index ")) {
      className = "diff-line diff-file";
    } else if (line.startsWith("@@")) {
      className = "diff-line diff-hunk";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      className = "diff-line diff-add";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className = "diff-line diff-remove";
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      className = "diff-line diff-file";
    }
    return `<div class="${className}">${escapeHtml(line || " ")}</div>`;
  }).join("");

  return `<div class="diff-view">${rows}</div>`;
}

function updatePrompt() {
  const entry = state.selectedId ? state.boxes.get(state.selectedId) : null;
  const instruction = dom.instructionInput.value.trim() || "Create a new app with BlackBoxApproach.";
  if (!entry || isProjectCreationInstruction(instruction)) {
    dom.promptOutput.value = buildProjectPrompt(instruction);
    dom.copyPromptButton.disabled = false;
    dom.sendPromptButton.disabled = false;
    return;
  }

  dom.copyPromptButton.disabled = false;
  dom.sendPromptButton.disabled = false;
  dom.promptOutput.value = buildPrompt(entry.id, instruction || "Refine the selected box.");
}

function selectedIdForCurrentPrompt() {
  const instruction = dom.instructionInput.value.trim();
  if (isProjectCreationInstruction(instruction)) {
    return null;
  }
  return state.selectedId;
}

function isProjectCreationInstruction(instruction) {
  const text = String(instruction || "").toLowerCase();
  if (!text.trim()) {
    return false;
  }
  const asksToCreate = /\b(create|start|build|make|generate|scaffold|new)\b/.test(text);
  const projectTarget = /\b(app|application|project|site|website|web app|static web app|tool)\b/.test(text);
  return asksToCreate && projectTarget;
}

function buildProjectPrompt(instruction) {
  const loadedContext = state.loadedFiles
    .filter(file => isSystemFile(file.path, safeParseYaml(file.text)) || file.path.startsWith("blackboxes/docs/"))
    .map(file => fileBlock(file.path, file.text))
    .join("\n\n") || "No project boxes exist yet.";

  return [
    "/blackboxapproach",
    "",
    "Task:",
    instruction,
    "",
    "Project mode:",
    "No box is currently selected.",
    "If this is a brand-new app, create a new project using project.path as the app directory name only, for example simple-notepad.",
    "Do not prefix project.path with projects/ because the user-selected folder is already the parent projects folder.",
    "Do not prefix file paths with the project name. If project.path is simple-notepad, write blackboxes/system.yaml, not simple-notepad/blackboxes/system.yaml.",
    "Each app or project must have its own directory, its own blackboxes/ directory, and its own .git directory.",
    "Create or update every file needed for the requested app, including blackboxes/system.yaml, boxes, data structures, executable code files, docs, prompts, and history when relevant.",
    "",
    "Current project context:",
    loadedContext,
    "",
    "Rules:",
    "- Return enough files for the visualizer to load a valid project graph.",
    "- The root box must be referenced by blackboxes/system.yaml root_box.",
    "- Every box YAML must include id, name, kind, box_type, state, provenance, human_summary, ai_reasoning, signature, intent, algorithm, children, contracts, referenced_data, and implementation.",
    "- The root box must be abstract. Its name must match the app/project name in readable title case.",
    "- The root intent and summary must be a plain-language resume of the user's project creation request, not an input/process/output formula.",
    "- Box names and intents must be easy for non-technical people to read, especially intermediate abstract boxes.",
    "- The root algorithm must call major child boxes with readable responsibility names.",
    "- children must contain child ids only, never file paths or .yaml names.",
    "- Refine recursively until leaf boxes are the actual implementation responsibilities.",
    "- Leaf boxes must include executable programming code in implementation.code.",
    "- Also create the real code files needed by the app, such as index.html, app.js, and style.css for a static web app.",
    "- Shared structures belong in blackboxes/data/.",
    "- Boxes belong in blackboxes/boxes/.",
    "- Track human_defined, ai_defined, and mixed provenance.",
    "- AI assumptions must include ai_reasoning.",
    "- If a newer human-defined parent decision conflicts with a human-defined child decision, warn the user and ask for explicit acceptance before changing the child from human_defined to ai_defined or mixed."
  ].join("\n");
}

function buildPrompt(selectedId, instruction) {
  const entry = state.boxes.get(selectedId);
  const descendants = collectDescendants(selectedId);
  const ancestors = findAncestorPath(selectedId);
  const relevantBoxIds = [selectedId, ...descendants];
  const dataRefs = new Set();

  for (const id of relevantBoxIds) {
    const boxEntry = state.boxes.get(id);
    if (!boxEntry) {
      continue;
    }
    for (const dataRef of getDataRefs(boxEntry.data)) {
      dataRefs.add(dataRef);
    }
  }

  const dataSections = Array.from(dataRefs)
    .map(ref => resolveDataRef(ref))
    .filter(Boolean)
    .filter(uniqueEntry)
    .map(dataEntry => fileBlock(dataEntry.path, dataEntry.text))
    .join("\n\n") || "No referenced data structures found.";

  const descendantYaml = descendants
    .map(id => state.boxes.get(id))
    .filter(Boolean)
    .map(child => fileBlock(child.path, child.text))
    .join("\n\n") || "No descendants currently exist.";

  const ancestorSummary = ancestors.length
    ? ancestors.map(id => summarizeAncestor(id)).join("\n")
    : "No ancestors found; selected box is a root.";

  const pathText = ancestors.length ? `${ancestors.join(" -> ")} -> ${selectedId}` : selectedId;

  return [
    "/blackboxapproach",
    "",
    "Task:",
    instruction,
    "",
    "Selected modification root:",
    selectedId,
    "",
    "Allowed modification boundary:",
    `You may modify ${selectedId} and its descendants.`,
    "You may create new descendant boxes if needed.",
    "You may modify referenced data structures only if the selected box or descendants require it.",
    "You must not modify ancestor boxes.",
    "This is an edit to the currently open project. Do not include project.path and do not create a new project directory.",
    "Return file paths relative to the current project root, for example blackboxes/boxes/example.yaml.",
    "",
    "Ancestor context, read-only:",
    pathText,
    "",
    ancestorSummary,
    "",
    "Selected box YAML:",
    fileBlock(entry.path, entry.text),
    "",
    "Descendant box YAML:",
    descendantYaml,
    "",
    "Referenced data structures:",
    dataSections,
    "",
    "Rules:",
    "- Preserve signature compatibility unless the human instruction explicitly requires changing it.",
    "- Preserve existing contracts unless the human instruction explicitly changes them.",
    "- Preserve graph consistency.",
    "- Add missing child boxes for new CALL references.",
    "- Track human_defined, ai_defined, and mixed provenance.",
    "- AI assumptions must include ai_reasoning.",
    "- Human-specified changes must be marked human_defined or mixed as appropriate.",
    "- If a newer human-defined parent decision conflicts with a human-defined child decision, warn the user and ask for explicit acceptance before changing the child from human_defined to ai_defined or mixed.",
    "- Without that acceptance, report the conflict as blocked and do not modify the child decision.",
    "- Ancestors are read-only context.",
    "- Descendants are editable."
  ].join("\n");
}

function safeParseYaml(text) {
  try {
    return parseYaml(text);
  } catch (error) {
    return {};
  }
}

function fileBlock(path, text) {
  return [`# ${path}`, "```yaml", text.trim(), "```"].join("\n");
}

function summarizeAncestor(id) {
  const entry = state.boxes.get(id);
  if (!entry) {
    return `- ${id}: missing`;
  }

  const intent = firstLine(entry.data.intent || "No intent recorded.");
  const contracts = entry.data.contracts ? compactList(entry.data.contracts.postconditions || []) : "No postconditions recorded.";
  return `- ${id}: ${intent} Postconditions: ${contracts}`;
}

async function copyPrompt() {
  if (!dom.promptOutput.value) {
    return;
  }

  await navigator.clipboard.writeText(dom.promptOutput.value);
  const original = dom.copyPromptButton.textContent;
  dom.copyPromptButton.textContent = "Copied";
  window.setTimeout(() => {
    dom.copyPromptButton.textContent = original;
  }, 1200);
}

function sendPromptToChatGPT() {
  updatePrompt();
  if (!dom.promptOutput.value) {
    return;
  }

  const promptSelectedId = selectedIdForCurrentPrompt();
  if (promptSelectedId && hasPendingGitChanges()) {
    receiveChatGPTError({
      message: "This project has uncommitted changes. Commit or discard them before asking ChatGPT for another modification."
    });
    return;
  }

  dom.sendPromptButton.disabled = true;
  dom.sendPromptButton.textContent = "Sending...";
  dom.loadStatus.textContent = "Sending prompt to ChatGPT...";
  postMacMessage({
    type: "sendPrompt",
    prompt: dom.promptOutput.value,
    selectedId: promptSelectedId
  });
}

function commitChanges() {
  if (!hasPendingGitChanges()) {
    return;
  }
  dom.commitChangesButton.disabled = true;
  dom.discardChangesButton.disabled = true;
  dom.loadStatus.textContent = "Committing project changes...";
  postMacMessage({
    type: "commitChanges",
    message: "Save BlackBoxApproach changes"
  });
}

function discardChanges() {
  if (!hasPendingGitChanges()) {
    return;
  }
  dom.chatModalTitle.textContent = "Discard Changes";
  dom.chatModalBody.innerHTML = [
    '<p class="warning-item error">Discard all uncommitted project changes? This cannot be undone.</p>',
    '<div class="modal-actions">',
    '<button id="confirmDiscardChangesButton" class="git-action-button danger" type="button">Discard Changes</button>',
    "</div>"
  ].join("");
  dom.chatModal.classList.remove("hidden-view");
}

function confirmDiscardChanges() {
  dom.commitChangesButton.disabled = true;
  dom.discardChangesButton.disabled = true;
  dom.chatModal.classList.add("hidden-view");
  dom.loadStatus.textContent = "Discarding project changes...";
  postMacMessage({
    type: "discardChanges"
  });
}

function handleChatModalClick(event) {
  const confirmButton = event.target.closest && event.target.closest("#confirmDiscardChangesButton");
  if (confirmButton) {
    confirmDiscardChanges();
  }
}

function receiveChatGPTResult(payload) {
  dom.sendPromptButton.disabled = false;
  dom.sendPromptButton.textContent = "Send";
  dom.loadStatus.textContent = "ChatGPT completed the request.";
  const writtenFiles = Array.isArray(payload && payload.writtenFiles) ? payload.writtenFiles : [];
  const message = payload && payload.message ? payload.message : "ChatGPT completed the request.";
  dom.chatModalTitle.textContent = "ChatGPT Result";
  dom.chatModalBody.innerHTML = [
    `<p>${escapeHtml(message)}</p>`,
    writtenFiles.length
      ? `<section class="detail-section"><h4>Files Written</h4><pre>${escapeHtml(writtenFiles.join("\n"))}</pre></section>`
      : '<p class="empty-state">No files were written.</p>',
    payload && payload.answer
      ? `<section class="detail-section"><h4>Answer</h4><pre>${escapeHtml(payload.answer)}</pre></section>`
      : ""
  ].join("");
  dom.chatModal.classList.remove("hidden-view");
  requestMacProjectSnapshot();
}

function receiveGitOperationResult(payload) {
  const message = payload && payload.message ? payload.message : "Git operation completed.";
  dom.loadStatus.textContent = message;
  dom.chatModalTitle.textContent = "Git Result";
  dom.chatModalBody.innerHTML = `<p>${escapeHtml(message)}</p>`;
  dom.chatModal.classList.remove("hidden-view");
  requestMacProjectSnapshot();
}

function receiveGitOperationError(payload) {
  const message = payload && payload.message ? payload.message : "Git operation failed.";
  dom.loadStatus.textContent = "Git operation failed.";
  dom.chatModalTitle.textContent = "Git Error";
  dom.chatModalBody.innerHTML = `<p class="warning-item error">${escapeHtml(message)}</p>`;
  dom.chatModal.classList.remove("hidden-view");
  renderGitActions();
}

function receiveChatGPTError(payload) {
  dom.sendPromptButton.disabled = false;
  dom.sendPromptButton.textContent = "Send";
  dom.loadStatus.textContent = "ChatGPT request failed.";
  dom.chatModalTitle.textContent = "ChatGPT Error";
  dom.chatModalBody.innerHTML = `<p class="warning-item error">${escapeHtml(payload && payload.message ? payload.message : "ChatGPT request failed.")}</p>`;
  dom.chatModal.classList.remove("hidden-view");
}

function setNativeStatus(message) {
  dom.loadStatus.textContent = String(message || "");
}

function closeChatModal() {
  dom.chatModal.classList.add("hidden-view");
}

function getPrimaryRootId() {
  const root = state.systemEntry && state.systemEntry.data && state.systemEntry.data.root_box;
  return root ? String(root) : null;
}

function getChildrenAndCalls(box) {
  return unique([...normalizeStringArray(box.children), ...extractCalls(box.algorithm)]);
}

function collectDescendants(rootId) {
  const result = [];
  const seen = new Set([rootId]);

  function visit(id) {
    const entry = state.boxes.get(id);
    if (!entry) {
      return;
    }
    for (const child of getChildrenAndCalls(entry.data)) {
      if (seen.has(child) || !state.boxes.has(child)) {
        continue;
      }
      seen.add(child);
      result.push(child);
      visit(child);
    }
  }

  visit(rootId);
  return result;
}

function findAncestorPath(selectedId) {
  const roots = [];
  const primaryRoot = getPrimaryRootId();
  if (primaryRoot && state.boxes.has(primaryRoot)) {
    roots.push(primaryRoot);
  }

  const referenced = new Set();
  for (const entry of state.boxEntries) {
    for (const child of getChildrenAndCalls(entry.data)) {
      referenced.add(child);
    }
  }

  for (const entry of state.boxEntries) {
    if (!referenced.has(entry.id) && !roots.includes(entry.id)) {
      roots.push(entry.id);
    }
  }

  for (const root of roots) {
    const path = findPath(root, selectedId, new Set());
    if (path) {
      return path.slice(0, -1);
    }
  }

  return [];
}

function findPath(current, target, seen) {
  if (current === target) {
    return [current];
  }
  if (seen.has(current)) {
    return null;
  }
  seen.add(current);

  const entry = state.boxes.get(current);
  if (!entry) {
    return null;
  }

  for (const child of getChildrenAndCalls(entry.data)) {
    const childPath = findPath(child, target, seen);
    if (childPath) {
      return [current, ...childPath];
    }
  }

  return null;
}

function collectReachable(rootId, childRefsByBox) {
  const reachable = new Set();

  function visit(id) {
    if (reachable.has(id)) {
      return;
    }
    reachable.add(id);
    for (const child of childRefsByBox.get(id) || []) {
      if (state.boxes.has(child)) {
        visit(child);
      }
    }
  }

  visit(rootId);
  return reachable;
}

function findCycles(childRefsByBox) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(id, path) {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      cycles.push([...path.slice(start), id]);
      return;
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    for (const child of childRefsByBox.get(id) || []) {
      if (state.boxes.has(child)) {
        visit(child, [...path, child]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of childRefsByBox.keys()) {
    visit(id, [id]);
  }

  return cycles;
}

function extractCalls(algorithm) {
  const calls = [];
  const text = String(algorithm || "");
  const regex = /\bCALL\s+([a-zA-Z][a-zA-Z0-9_]*)/g;
  let match = regex.exec(text);
  while (match) {
    calls.push(match[1]);
    match = regex.exec(text);
  }
  return unique(calls);
}

function getDataRefs(box) {
  const refs = [];
  const groups = getDataRefsByDirection(box);
  return unique([...groups.inputs, ...groups.outputs]);
}

function getDataRefsByDirection(box) {
  const refs = {
    inputs: [],
    outputs: []
  };
  const signature = box && box.signature;
  if (!signature || typeof signature !== "object") {
    return refs;
  }

  for (const port of normalizeArray(signature.inputs)) {
    if (port && typeof port === "object" && port.data_ref) {
      refs.inputs.push(String(port.data_ref));
    }
  }

  for (const port of normalizeArray(signature.outputs)) {
    if (port && typeof port === "object" && port.data_ref) {
      refs.outputs.push(String(port.data_ref));
    }
  }

  refs.inputs = unique(refs.inputs);
  refs.outputs = unique(refs.outputs);
  return refs;
}

function resolveDataRef(ref) {
  const base = basenameWithoutExtension(ref).toLowerCase();
  return state.dataByKey.get(base) || state.dataByKey.get(String(ref).toLowerCase()) || null;
}

function hasInlineFields(signature) {
  if (!signature || typeof signature !== "object") {
    return false;
  }

  return [...normalizeArray(signature.inputs), ...normalizeArray(signature.outputs)]
    .some(port => port && typeof port === "object" && Array.isArray(port.fields));
}

function isSystemFile(path, parsed) {
  return /(^|\/)system\.ya?ml$/i.test(path) || parsed.kind === "black_box_system";
}

function isBoxFile(path, parsed) {
  return parsed.kind === "black_box" || /(^|\/)boxes\//i.test(path);
}

function isDataFile(path, parsed) {
  return parsed.kind === "data_structure" || /(^|\/)data\//i.test(path);
}

function isLoadableFile(name) {
  return /\.(ya?ml|json|txt|patch|diff)$/i.test(name);
}

function isGitStatusFile(path) {
  return /(^|\/)git_status\.txt$/i.test(path) || /(^|\/)git-status\.txt$/i.test(path);
}

function isGitDiffFile(path) {
  return /(^|\/)git_diff\.(patch|diff)$/i.test(path) || /(^|\/)git-diff\.(patch|diff)$/i.test(path);
}

function parseGitStatus(text) {
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    if (line.length < 4 || line[2] !== " ") {
      continue;
    }
    const statusCode = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    if (!rawPath) {
      continue;
    }
    const path = normalizeGitPath(rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath);
    const status = gitStatusKind(statusCode);
    state.gitChanges.set(path, {
      path,
      status,
      label: gitStatusLabel(status),
      short: gitStatusShort(status)
    });
  }
}

function parseGitDiff(text) {
  const lines = String(text || "").split("\n");
  let currentPath = null;
  let buffer = [];

  function flush() {
    if (currentPath) {
      state.gitDiffs.set(currentPath, buffer.join("\n"));
    }
  }

  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      flush();
      currentPath = normalizeGitPath(match[2]);
      buffer = [line];
    } else if (currentPath) {
      buffer.push(line);
    }
  }
  flush();
}

function gitStatusKind(code) {
  if (code.includes("?")) {
    return "untracked";
  }
  if (code.includes("A")) {
    return "added";
  }
  if (code.includes("D")) {
    return "deleted";
  }
  if (code.includes("R")) {
    return "renamed";
  }
  return "modified";
}

function gitStatusLabel(status) {
  return {
    added: "added",
    deleted: "deleted",
    renamed: "renamed",
    untracked: "untracked",
    modified: "modified"
  }[status] || "changed";
}

function gitStatusShort(status) {
  return {
    added: "A",
    deleted: "D",
    renamed: "R",
    untracked: "?",
    modified: "M"
  }[status] || "!";
}

function gitClass(status) {
  return `git-${escapeClass(status || "changed")}`;
}

function getGitChangeForPath(path) {
  return state.gitChanges.get(normalizeGitPath(path)) || null;
}

function hasPendingGitChanges() {
  return state.gitChanges.size > 0;
}

function normalizeGitPath(path) {
  return normalizePath(path).replace(/^a\//, "").replace(/^b\//, "");
}

function showLoadError(message) {
  state.validation.push({
    severity: "error",
    message: message || "Could not load files"
  });
  renderWarnings();
}

function parseYaml(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map(raw => ({
    raw,
    indent: countIndent(raw)
  }));

  const [value] = parseNode(0, 0);
  return value && typeof value === "object" ? value : {};

  function parseNode(index, indent) {
    let i = skipIgnorable(index);
    if (i >= lines.length) {
      return [{}, i];
    }
    if (lines[i].indent < indent) {
      return [{}, i];
    }

    const textAtIndent = lines[i].raw.slice(lines[i].indent);
    if (textAtIndent.startsWith("- ")) {
      return parseArray(i, lines[i].indent);
    }
    return parseMap(i, lines[i].indent);
  }

  function parseMap(index, indent) {
    const object = {};
    let i = index;

    while (i < lines.length) {
      i = skipIgnorable(i);
      if (i >= lines.length) {
        break;
      }

      const line = lines[i];
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent) {
        i += 1;
        continue;
      }

      const body = line.raw.slice(line.indent);
      if (body.startsWith("- ")) {
        break;
      }

      const pair = parseKeyValue(body);
      if (!pair) {
        i += 1;
        continue;
      }

      const parsedValue = parseValue(pair.value, i, line.indent);
      object[pair.key] = parsedValue.value;
      i = parsedValue.next;
    }

    return [object, i];
  }

  function parseArray(index, indent) {
    const array = [];
    let i = index;

    while (i < lines.length) {
      i = skipIgnorable(i);
      if (i >= lines.length) {
        break;
      }

      const line = lines[i];
      if (line.indent < indent) {
        break;
      }
      if (line.indent !== indent) {
        i += 1;
        continue;
      }

      const body = line.raw.slice(line.indent);
      if (!body.startsWith("- ")) {
        break;
      }

      const itemText = body.slice(2).trim();
      if (!itemText) {
        const [child, next] = parseNode(i + 1, indent + 2);
        array.push(child);
        i = next;
        continue;
      }

      const pair = parseKeyValue(itemText);
      if (pair) {
        const object = {};
        const parsedValue = parseValue(pair.value, i, line.indent);
        object[pair.key] = parsedValue.value;
        i = parsedValue.next === i ? i + 1 : parsedValue.next;

        while (i < lines.length) {
          i = skipIgnorable(i);
          if (i >= lines.length || lines[i].indent <= indent) {
            break;
          }
          const [more, next] = parseMap(i, lines[i].indent);
          Object.assign(object, more);
          i = next;
        }

        array.push(object);
      } else {
        array.push(parseScalar(itemText));
        i += 1;
      }
    }

    return [array, i];
  }

  function parseValue(rawValue, lineIndex, parentIndent) {
    const value = rawValue.trim();
    if (value === "|" || value === ">") {
      const block = collectBlock(lineIndex + 1, parentIndent, value === ">");
      return { value: block.value, next: block.next };
    }

    if (value === "") {
      const [child, next] = parseNode(lineIndex + 1, parentIndent + 2);
      return { value: child, next };
    }

    return { value: parseScalar(value), next: lineIndex + 1 };
  }

  function collectBlock(index, parentIndent, folded) {
    const blockLines = [];
    let i = index;
    let minIndent = null;

    while (i < lines.length) {
      const raw = lines[i].raw;
      const trimmed = raw.trim();

      if (trimmed === "") {
        blockLines.push("");
        i += 1;
        continue;
      }

      const indent = lines[i].indent;
      if (indent <= parentIndent) {
        break;
      }

      minIndent = minIndent === null ? indent : Math.min(minIndent, indent);
      blockLines.push(raw);
      i += 1;
    }

    const trimBy = minIndent === null ? parentIndent + 2 : minIndent;
    const normalized = blockLines.map(line => line.trim() === "" ? "" : line.slice(Math.min(trimBy, countIndent(line))));
    return {
      value: folded ? normalized.join(" ").replace(/\s+/g, " ").trim() : normalized.join("\n").trimEnd(),
      next: i
    };
  }

  function skipIgnorable(index) {
    let i = index;
    while (i < lines.length) {
      const trimmed = lines[i].raw.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        break;
      }
      i += 1;
    }
    return i;
  }
}

function parseKeyValue(text) {
  const colon = text.indexOf(":");
  if (colon < 0) {
    return null;
  }

  const key = text.slice(0, colon).trim().replace(/^["']|["']$/g, "");
  const value = text.slice(colon + 1).trim();
  if (!key) {
    return null;
  }
  return { key, value };
}

function parseScalar(value) {
  const trimmed = stripInlineComment(value.trim());
  if (trimmed === "null" || trimmed === "~") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^\[.*\]$/.test(trimmed)) {
    const inside = trimmed.slice(1, -1).trim();
    return inside ? inside.split(",").map(item => parseScalar(item.trim())) : [];
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function stripInlineComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === "'" || char === '"') && value[i - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
    }
    if (char === "#" && !quote && /\s/.test(value[i - 1] || "")) {
      return value.slice(0, i).trim();
    }
  }
  return value;
}

function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) {
      return "[]";
    }
    return value.map(item => {
      if (item && typeof item === "object") {
        return `${pad}- ${toYaml(item, indent + 2).trimStart()}`;
      }
      return `${pad}- ${String(item)}`;
    }).join("\n");
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, child]) => {
      if (child && typeof child === "object") {
        const rendered = toYaml(child, indent + 2);
        return `${pad}${key}:\n${rendered}`;
      }
      return `${pad}${key}: ${child === null ? "null" : String(child)}`;
    }).join("\n");
  }

  return `${pad}${value === null ? "null" : String(value)}`;
}

function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function basenameWithoutExtension(path) {
  const clean = normalizePath(path).split("/").pop() || "";
  return clean.replace(/\.[^.]+$/, "");
}

function countIndent(line) {
  const match = String(line || "").match(/^ */);
  return match ? match[0].length : 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value) {
  return normalizeArray(value).map(item => String(item)).filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(value => value !== undefined && value !== null && value !== "")));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function uniqueEntry(entry, index, entries) {
  return entries.findIndex(candidate => candidate.path === entry.path) === index;
}

function compactList(value) {
  const items = normalizeArray(value);
  return items.length ? items.join("; ") : "None.";
}

function firstLine(value) {
  return String(value || "").split("\n").map(line => line.trim()).find(Boolean) || "";
}

function badge(value) {
  if (!value) {
    return "";
  }
  return `<span class="badge ${escapeClass(value)}">${escapeHtml(String(value))}</span>`;
}

function formatProvenance(value) {
  if (value === "human_defined") {
    return "human";
  }
  if (value === "ai_defined") {
    return "ai";
  }
  return escapeHtml(value || "unknown");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeClass(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

init();

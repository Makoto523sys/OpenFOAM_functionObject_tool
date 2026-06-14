(function startSamplingApp() {
  const {
    buildFunctionsBlock,
    createDefaultState,
    normalizeFields,
    sanitizeFoamWord,
    validateSamplingState,
  } = window.OpenFoamSampling;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const NUMBER_PROPS = new Set(["rhoInf", "magUInf", "lRef", "Aref"]);
  const FIELD_LIST_PROPS = new Set(["fields"]);

  const state = createDefaultState();
  let objectControlsHydrated = false;

  const elements = {
    customFields: $("#customFields"),
    writeControl: $("#writeControl"),
    writeInterval: $("#writeInterval"),
    interpolationScheme: $("#interpolationScheme"),
    pointRows: $("#pointRows"),
    lineRows: $("#lineRows"),
    patchRows: $("#patchRows"),
    output: $("#output"),
    validationMessages: $("#validationMessages"),
    copyOutput: $("#copyOutput"),
    downloadOutput: $("#downloadOutput"),
    sampleCount: $("#sampleCount"),
    fieldCount: $("#fieldCount"),
  };

  function render() {
    if (objectControlsHydrated) {
      syncFormInputs();
    } else {
      syncCommonInputs();
    }
    renderSamples("point", state.points, elements.pointRows, "#pointTemplate");
    renderSamples("line", state.lines, elements.lineRows, "#lineTemplate");
    renderSamples("patch", state.patches, elements.patchRows, "#patchTemplate");
    renderFunctionObjectControls();
    objectControlsHydrated = true;
    updateOutput();
  }

  function syncFormInputs() {
    syncCommonInputs();
    syncFunctionObjectInputs();
  }

  function syncCommonInputs() {
    const checkboxFields = new Set($$("[data-field-token]:checked").map((input) => input.dataset.fieldToken));
    const customFields = normalizeFields(elements.customFields.value);
    state.fields = [...new Set([...checkboxFields, ...customFields])];
    state.writeControl = elements.writeControl.value;
    state.writeInterval = Number(elements.writeInterval.value);
    state.interpolationScheme = elements.interpolationScheme.value;
  }

  function syncFunctionObjectInputs() {
    for (const input of $$("[data-object][data-fo-prop]")) {
      const objectName = input.dataset.object;
      const prop = input.dataset.foProp;
      const target = state.functionObjects[objectName];
      if (!target) continue;

      setObjectValue(target, prop, input);
    }
  }

  function setObjectValue(target, prop, input) {
    if (prop.includes(".")) {
      const [key, index] = prop.split(".");
      target[key][Number(index)] = input.value === "" ? "" : Number(input.value);
      return;
    }

    if (input.type === "checkbox") {
      target[prop] = input.checked;
      return;
    }

    if (prop === "patchNames") {
      target.patchNames = String(input.value)
        .split(/[\s,]+/)
        .map((name) => sanitizeFoamWord(name, ""))
        .filter(Boolean);
      return;
    }

    if (NUMBER_PROPS.has(prop)) {
      target[prop] = input.value === "" ? "" : Number(input.value);
      return;
    }

    if (FIELD_LIST_PROPS.has(prop)) {
      target[prop] = normalizeFields(input.value);
      return;
    }

    target[prop] = input.value;
  }

  function renderFunctionObjectControls() {
    for (const input of $$("[data-object][data-fo-prop]")) {
      const objectName = input.dataset.object;
      const prop = input.dataset.foProp;
      const source = state.functionObjects[objectName];
      if (!source) continue;

      const value = getObjectValue(source, prop);
      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else {
        input.value = value;
      }
    }
  }

  function getObjectValue(source, prop) {
    if (prop === "patchNames") return source.patchNames.join(" ");
    if (FIELD_LIST_PROPS.has(prop)) return source[prop].join(" ");
    if (prop.includes(".")) {
      const [key, index] = prop.split(".");
      return source[key]?.[Number(index)] ?? "";
    }
    return source[prop] ?? "";
  }

  function renderSamples(kind, items, container, templateSelector) {
    container.replaceChildren(
      ...items.map((item, index) => {
        const node = $(templateSelector).content.firstElementChild.cloneNode(true);
        node.dataset.index = String(index);
        fillSampleNode(kind, node, item);
        return node;
      }),
    );
  }

  function fillSampleNode(kind, node, item) {
    for (const input of Array.from(node.querySelectorAll("[data-prop]"))) {
      const prop = input.dataset.prop;
      input.value = getSampleValue(item, prop);
      input.dataset.kind = kind;
    }
  }

  function getSampleValue(item, prop) {
    if (prop === "patchNames") return item.patchNames.join(" ");
    const [key, index] = prop.split(".");
    if (index !== undefined) return item[key]?.[Number(index)] ?? "";
    return item[key] ?? "";
  }

  function updateOutput() {
    syncFormInputs();
    const errors = validateSamplingState(state);
    markInvalidInputs();

    elements.validationMessages.classList.toggle("active", errors.length > 0);
    elements.validationMessages.replaceChildren(...errors.map((error) => {
      const div = document.createElement("div");
      div.textContent = error;
      return div;
    }));

    const sampleTotal = state.points.length + state.lines.length + state.patches.length;
    const objectTotal = Object.values(state.functionObjects).filter((item) => item.enabled).length;
    elements.sampleCount.textContent = `${sampleTotal} samples / ${objectTotal} objects`;
    elements.fieldCount.textContent = `${state.fields.length} fields`;
    elements.copyOutput.disabled = errors.length > 0;
    elements.downloadOutput.disabled = errors.length > 0;
    elements.output.textContent = errors.length > 0 ? "" : buildFunctionsBlock(state);
  }

  function markInvalidInputs() {
    $$(".invalid").forEach((input) => input.classList.remove("invalid"));

    const samplingEnabled = state.points.length > 0 || state.lines.length > 0 || state.patches.length > 0;
    if (samplingEnabled && state.fields.length === 0) {
      elements.customFields.classList.add("invalid");
    }

    if (!Number.isFinite(Number(elements.writeInterval.value)) || Number(elements.writeInterval.value) <= 0) {
      elements.writeInterval.classList.add("invalid");
    }

    for (const card of $$(".sample-card")) {
      const kind = card.dataset.kind;
      const index = Number(card.dataset.index);
      const item = collectionFor(kind)[index];

      for (const input of Array.from(card.querySelectorAll("[data-prop]"))) {
        const prop = input.dataset.prop;
        if (prop === "nPoints" && (!Number.isInteger(Number(input.value)) || Number(input.value) < 2)) {
          input.classList.add("invalid");
        }
        if (prop.includes(".") && !Number.isFinite(Number(input.value))) {
          input.classList.add("invalid");
        }
        if (prop === "patchNames" && String(item.patchNames.join(" ")).trim() === "") {
          input.classList.add("invalid");
        }
      }
    }

    markInvalidFunctionObjects();
  }

  function markInvalidFunctionObjects() {
    const objects = state.functionObjects;

    if (objects.forces.enabled) {
      markIfInvalid("forces", "patchNames", objects.forces.patchNames.length === 0);
      markIfInvalid("forces", "rhoInf", !isPositiveNumber(objects.forces.rhoInf));
      markVectorInvalid("forces", "CofR", objects.forces.CofR);
    }

    if (objects.forceCoeffs.enabled) {
      markIfInvalid("forceCoeffs", "patchNames", objects.forceCoeffs.patchNames.length === 0);
      for (const prop of ["rhoInf", "magUInf", "lRef", "Aref"]) {
        markIfInvalid("forceCoeffs", prop, !isPositiveNumber(objects.forceCoeffs[prop]));
      }
      for (const prop of ["liftDir", "dragDir", "pitchAxis", "CofR"]) {
        markVectorInvalid("forceCoeffs", prop, objects.forceCoeffs[prop]);
      }
    }

    if (objects.wallHeatFlux.enabled) {
      markIfInvalid("wallHeatFlux", "qr", !sanitizeFoamWord(objects.wallHeatFlux.qr, ""));
    }

    if (objects.surfaceFieldValue.enabled) {
      markIfInvalid("surfaceFieldValue", "patchName", !sanitizeFoamWord(objects.surfaceFieldValue.patchName, ""));
      markIfInvalid("surfaceFieldValue", "fields", objects.surfaceFieldValue.fields.length === 0);
      markIfInvalid("surfaceFieldValue", "operation", !sanitizeFoamWord(objects.surfaceFieldValue.operation, ""));
    }

    if (objects.flowRatePatch.enabled) {
      markIfInvalid("flowRatePatch", "patchName", !sanitizeFoamWord(objects.flowRatePatch.patchName, ""));
      markIfInvalid("flowRatePatch", "phi", !sanitizeFoamWord(objects.flowRatePatch.phi, ""));
    }

    if (objects.fieldMinMax.enabled) {
      markIfInvalid("fieldMinMax", "fields", objects.fieldMinMax.fields.length === 0);
      markIfInvalid("fieldMinMax", "mode", !["magnitude", "component"].includes(String(objects.fieldMinMax.mode)));
    }
  }

  function markIfInvalid(objectName, prop, invalid) {
    if (!invalid) return;
    const input = $(`[data-object="${objectName}"][data-fo-prop="${prop}"]`);
    if (input) input.classList.add("invalid");
  }

  function markVectorInvalid(objectName, prop, vector) {
    if (isVector(vector)) return;
    for (let index = 0; index < 3; index += 1) {
      markIfInvalid(objectName, `${prop}.${index}`, true);
    }
  }

  function collectionFor(kind) {
    if (kind === "point") return state.points;
    if (kind === "line") return state.lines;
    return state.patches;
  }

  function addSample(kind) {
    if (kind === "point") {
      state.points.push({
        name: `point${state.points.length + 1}`,
        location: [0, 0, 0],
      });
    }

    if (kind === "line") {
      state.lines.push({
        name: `line${state.lines.length + 1}`,
        start: [0, 0, 0],
        end: [1, 0, 0],
        nPoints: 50,
      });
    }

    if (kind === "patch") {
      state.patches.push({
        name: `patchSurface${state.patches.length + 1}`,
        patchNames: ["walls"],
      });
    }

    render();
  }

  function removeSample(kind, index) {
    collectionFor(kind).splice(index, 1);
    render();
  }

  function updateSampleFromInput(input) {
    const card = input.closest(".sample-card");
    if (!card) return;

    const kind = card.dataset.kind;
    const index = Number(card.dataset.index);
    const item = collectionFor(kind)[index];
    const prop = input.dataset.prop;

    if (prop === "patchNames") {
      item.patchNames = String(input.value)
        .split(/[\s,]+/)
        .map((name) => sanitizeFoamWord(name, ""))
        .filter(Boolean);
    } else if (prop.includes(".")) {
      const [key, vectorIndex] = prop.split(".");
      item[key][Number(vectorIndex)] = input.value === "" ? "" : Number(input.value);
    } else if (prop === "nPoints") {
      item.nPoints = input.value === "" ? "" : Number(input.value);
    } else {
      item[prop] = input.value;
    }

    updateOutput();
  }

  async function copyOutput() {
    const text = elements.output.textContent;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      flashButton(elements.copyOutput, "コピー済み");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      flashButton(elements.copyOutput, "コピー済み");
    }
  }

  function downloadOutput() {
    const text = elements.output.textContent;
    if (!text) return;

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "openfoam-functions.txt";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function flashButton(button, label) {
    const original = button.textContent;
    button.textContent = label;
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }

  function bindEvents() {
    for (const input of $$("[data-field-token]")) {
      input.addEventListener("change", updateOutput);
    }

    for (const input of [elements.customFields, elements.writeInterval]) {
      input.addEventListener("input", updateOutput);
    }

    for (const select of [elements.writeControl, elements.interpolationScheme]) {
      select.addEventListener("change", updateOutput);
    }

    for (const input of $$("[data-object][data-fo-prop]")) {
      input.addEventListener(input.type === "checkbox" ? "change" : "input", updateOutput);
    }

    $("#addPoint").addEventListener("click", () => addSample("point"));
    $("#addLine").addEventListener("click", () => addSample("line"));
    $("#addPatch").addEventListener("click", () => addSample("patch"));

    for (const container of [elements.pointRows, elements.lineRows, elements.patchRows]) {
      container.addEventListener("input", (event) => {
        const input = event.target.closest("[data-prop]");
        if (input) updateSampleFromInput(input);
      });

      container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action='remove']");
        if (!button) return;
        const card = button.closest(".sample-card");
        removeSample(card.dataset.kind, Number(card.dataset.index));
      });
    }

    elements.copyOutput.addEventListener("click", copyOutput);
    elements.downloadOutput.addEventListener("click", downloadOutput);
  }

  function isPositiveNumber(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function isVector(value) {
    return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)));
  }

  bindEvents();
  render();
})();

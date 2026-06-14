(function attachSamplingGenerator(global) {
  const DEFAULT_STATE = Object.freeze({
    fields: Object.freeze(["U", "p"]),
    writeControl: "timeStep",
    writeInterval: 1,
    interpolationScheme: "cellPoint",
    points: Object.freeze([]),
    lines: Object.freeze([]),
    patches: Object.freeze([]),
  });

  const WRITE_CONTROLS = new Set(["timeStep", "writeTime", "runTime"]);
  const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;

  function createDefaultState() {
    return {
      fields: [...DEFAULT_STATE.fields],
      writeControl: DEFAULT_STATE.writeControl,
      writeInterval: DEFAULT_STATE.writeInterval,
      interpolationScheme: DEFAULT_STATE.interpolationScheme,
      points: [],
      lines: [],
      patches: [],
      functionObjects: {
        forces: {
          enabled: false,
          name: "forces1",
          patchNames: ["walls"],
          rhoInf: 1,
          CofR: [0, 0, 0],
          log: true,
        },
        forceCoeffs: {
          enabled: false,
          name: "forceCoeffs1",
          patchNames: ["walls"],
          rhoInf: 1,
          liftDir: [0, 1, 0],
          dragDir: [1, 0, 0],
          pitchAxis: [0, 0, 1],
          CofR: [0, 0, 0],
          magUInf: 1,
          lRef: 1,
          Aref: 1,
          log: true,
        },
        wallShearStress: {
          enabled: false,
          name: "wallShearStress1",
          patchNames: ["walls"],
          writeFields: true,
        },
        wallHeatFlux: {
          enabled: false,
          name: "wallHeatFlux1",
          patchNames: ["walls"],
          qr: "qr",
        },
        yPlus: {
          enabled: false,
          name: "yPlus1",
          useWallFunction: true,
          writeFields: true,
        },
        surfaceFieldValue: {
          enabled: false,
          name: "surfaceFieldValue1",
          patchName: "outlet",
          fields: ["U", "p"],
          operation: "areaAverage",
          writeArea: false,
          writeFields: false,
          surfaceFormat: "none",
          log: true,
        },
        flowRatePatch: {
          enabled: false,
          name: "flowRatePatch1",
          patchName: "outlet",
          phi: "phi",
          log: true,
        },
        fieldMinMax: {
          enabled: false,
          name: "fieldMinMax1",
          fields: ["U", "p"],
          mode: "magnitude",
          location: true,
          log: true,
        },
      },
    };
  }

  function buildFunctionsBlock(input = {}) {
    const state = normalizeState(input);
    const blocks = [];

    if (state.points.length > 0) {
      blocks.push(buildPointProbes(state));
    }

    if (state.lines.length > 0) {
      blocks.push(buildLineSamples(state));
    }

    if (state.patches.length > 0) {
      blocks.push(buildPatchSamples(state));
    }

    blocks.push(...buildGeneralFunctionObjects(state));

    return [
      "functions",
      "{",
      ...joinBlocks(blocks),
      "}",
      "",
    ].join("\n");
  }

  function validateSamplingState(input = {}) {
    const errors = [];
    const samplingEnabled =
      arrayOrEmpty(input.points).length > 0 ||
      arrayOrEmpty(input.lines).length > 0 ||
      arrayOrEmpty(input.patches).length > 0;
    const fields = normalizeFields(input.fields);

    if (samplingEnabled && fields.length === 0) {
      errors.push("サンプリング用fieldsを1つ以上指定してください。");
    }

    if (!isPositiveNumber(input.writeInterval)) {
      errors.push("writeIntervalは正の数を指定してください。");
    }

    input.points?.forEach((point, index) => {
      if (!isVector(point.location)) {
        errors.push(`点サンプル ${index + 1}: 座標は数値3成分で指定してください。`);
      }
    });

    input.lines?.forEach((line, index) => {
      if (!isVector(line.start)) {
        errors.push(`線サンプル ${index + 1}: startは数値3成分で指定してください。`);
      }
      if (!isVector(line.end)) {
        errors.push(`線サンプル ${index + 1}: endは数値3成分で指定してください。`);
      }
      if (!Number.isInteger(Number(line.nPoints)) || Number(line.nPoints) < 2) {
        errors.push(`線サンプル ${index + 1}: nPointsは2以上の整数を指定してください。`);
      }
    });

    input.patches?.forEach((patch, index) => {
      if (normalizeNameList(patch.patchNames).length === 0) {
        errors.push(`patch面サンプル ${index + 1}: patch名を1つ以上指定してください。`);
      }
    });

    validateFunctionObjects(input.functionObjects, errors);

    return errors;
  }

  function normalizeFields(value) {
    const fields = Array.isArray(value)
      ? value
      : String(value ?? "")
          .split(/[\s,]+/)
          .filter(Boolean);

    return [...new Set(fields.map((field) => String(field).trim()).filter((field) => FIELD_PATTERN.test(field)))];
  }

  function sanitizeFoamWord(value, fallback) {
    const raw = String(value ?? "").trim();
    const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
    return NAME_PATTERN.test(cleaned) ? cleaned : fallback;
  }

  function normalizeState(input) {
    const fields = normalizeFields(input.fields);
    const writeControl = WRITE_CONTROLS.has(input.writeControl) ? input.writeControl : DEFAULT_STATE.writeControl;
    const writeInterval = isPositiveNumber(input.writeInterval) ? Number(input.writeInterval) : DEFAULT_STATE.writeInterval;
    const interpolationScheme = sanitizeFoamWord(input.interpolationScheme, DEFAULT_STATE.interpolationScheme);

    return {
      fields,
      writeControl,
      writeInterval,
      interpolationScheme,
      points: normalizePoints(input.points),
      lines: normalizeLines(input.lines),
      patches: normalizePatches(input.patches),
      functionObjects: normalizeFunctionObjects(input.functionObjects),
    };
  }

  function normalizePoints(points) {
    return arrayOrEmpty(points)
      .filter((point) => isVector(point.location))
      .map((point, index) => ({
        name: sanitizeFoamWord(point.name, `point${index + 1}`),
        location: normalizeVector(point.location),
      }));
  }

  function normalizeLines(lines) {
    return arrayOrEmpty(lines)
      .filter((line) => isVector(line.start) && isVector(line.end) && Number(line.nPoints) >= 2)
      .map((line, index) => ({
        name: sanitizeFoamWord(line.name, `line${index + 1}`),
        start: normalizeVector(line.start),
        end: normalizeVector(line.end),
        nPoints: Math.max(2, Math.trunc(Number(line.nPoints))),
      }));
  }

  function normalizePatches(patches) {
    return arrayOrEmpty(patches)
      .map((patch, index) => ({
        name: sanitizeFoamWord(patch.name, `patchSurface${index + 1}`),
        patchNames: normalizeNameList(patch.patchNames),
      }))
      .filter((patch) => patch.patchNames.length > 0);
  }

  function normalizeFunctionObjects(input = {}) {
    const defaults = createDefaultState().functionObjects;
    const source = isPlainObject(input) ? input : {};

    return {
      forces: {
        ...defaults.forces,
        ...source.forces,
        name: sanitizeFoamWord(source.forces?.name, defaults.forces.name),
        patchNames: normalizeNameList(source.forces?.patchNames ?? defaults.forces.patchNames),
        rhoInf: positiveNumberOrDefault(source.forces?.rhoInf, defaults.forces.rhoInf),
        CofR: vectorOrDefault(source.forces?.CofR, defaults.forces.CofR),
        log: boolOrDefault(source.forces?.log, defaults.forces.log),
      },
      forceCoeffs: {
        ...defaults.forceCoeffs,
        ...source.forceCoeffs,
        name: sanitizeFoamWord(source.forceCoeffs?.name, defaults.forceCoeffs.name),
        patchNames: normalizeNameList(source.forceCoeffs?.patchNames ?? defaults.forceCoeffs.patchNames),
        rhoInf: positiveNumberOrDefault(source.forceCoeffs?.rhoInf, defaults.forceCoeffs.rhoInf),
        liftDir: vectorOrDefault(source.forceCoeffs?.liftDir, defaults.forceCoeffs.liftDir),
        dragDir: vectorOrDefault(source.forceCoeffs?.dragDir, defaults.forceCoeffs.dragDir),
        pitchAxis: vectorOrDefault(source.forceCoeffs?.pitchAxis, defaults.forceCoeffs.pitchAxis),
        CofR: vectorOrDefault(source.forceCoeffs?.CofR, defaults.forceCoeffs.CofR),
        magUInf: positiveNumberOrDefault(source.forceCoeffs?.magUInf, defaults.forceCoeffs.magUInf),
        lRef: positiveNumberOrDefault(source.forceCoeffs?.lRef, defaults.forceCoeffs.lRef),
        Aref: positiveNumberOrDefault(source.forceCoeffs?.Aref, defaults.forceCoeffs.Aref),
        log: boolOrDefault(source.forceCoeffs?.log, defaults.forceCoeffs.log),
      },
      wallShearStress: {
        ...defaults.wallShearStress,
        ...source.wallShearStress,
        name: sanitizeFoamWord(source.wallShearStress?.name, defaults.wallShearStress.name),
        patchNames: normalizeNameList(source.wallShearStress?.patchNames ?? defaults.wallShearStress.patchNames),
        writeFields: boolOrDefault(source.wallShearStress?.writeFields, defaults.wallShearStress.writeFields),
      },
      wallHeatFlux: {
        ...defaults.wallHeatFlux,
        ...source.wallHeatFlux,
        name: sanitizeFoamWord(source.wallHeatFlux?.name, defaults.wallHeatFlux.name),
        patchNames: normalizeNameList(source.wallHeatFlux?.patchNames ?? defaults.wallHeatFlux.patchNames),
        qr: sanitizeFoamWord(source.wallHeatFlux?.qr, defaults.wallHeatFlux.qr),
      },
      yPlus: {
        ...defaults.yPlus,
        ...source.yPlus,
        name: sanitizeFoamWord(source.yPlus?.name, defaults.yPlus.name),
        useWallFunction: boolOrDefault(source.yPlus?.useWallFunction, defaults.yPlus.useWallFunction),
        writeFields: boolOrDefault(source.yPlus?.writeFields, defaults.yPlus.writeFields),
      },
      surfaceFieldValue: {
        ...defaults.surfaceFieldValue,
        ...source.surfaceFieldValue,
        name: sanitizeFoamWord(source.surfaceFieldValue?.name, defaults.surfaceFieldValue.name),
        patchName: sanitizeFoamWord(source.surfaceFieldValue?.patchName, defaults.surfaceFieldValue.patchName),
        fields: normalizeFields(source.surfaceFieldValue?.fields ?? defaults.surfaceFieldValue.fields),
        operation: sanitizeFoamWord(source.surfaceFieldValue?.operation, defaults.surfaceFieldValue.operation),
        writeArea: boolOrDefault(source.surfaceFieldValue?.writeArea, defaults.surfaceFieldValue.writeArea),
        writeFields: boolOrDefault(source.surfaceFieldValue?.writeFields, defaults.surfaceFieldValue.writeFields),
        surfaceFormat: sanitizeFoamWord(source.surfaceFieldValue?.surfaceFormat, defaults.surfaceFieldValue.surfaceFormat),
        log: boolOrDefault(source.surfaceFieldValue?.log, defaults.surfaceFieldValue.log),
      },
      flowRatePatch: {
        ...defaults.flowRatePatch,
        ...source.flowRatePatch,
        name: sanitizeFoamWord(source.flowRatePatch?.name, defaults.flowRatePatch.name),
        patchName: sanitizeFoamWord(source.flowRatePatch?.patchName, defaults.flowRatePatch.patchName),
        phi: sanitizeFoamWord(source.flowRatePatch?.phi, defaults.flowRatePatch.phi),
        log: boolOrDefault(source.flowRatePatch?.log, defaults.flowRatePatch.log),
      },
      fieldMinMax: {
        ...defaults.fieldMinMax,
        ...source.fieldMinMax,
        name: sanitizeFoamWord(source.fieldMinMax?.name, defaults.fieldMinMax.name),
        fields: normalizeFields(source.fieldMinMax?.fields ?? defaults.fieldMinMax.fields),
        mode: sanitizeFoamWord(source.fieldMinMax?.mode, defaults.fieldMinMax.mode),
        location: boolOrDefault(source.fieldMinMax?.location, defaults.fieldMinMax.location),
        log: boolOrDefault(source.fieldMinMax?.log, defaults.fieldMinMax.log),
      },
    };
  }

  function validateFunctionObjects(input = {}, errors) {
    const objects = isPlainObject(input) ? input : {};

    if (objects.forces?.enabled) {
      if (normalizeNameList(objects.forces.patchNames).length === 0) {
        errors.push("forces: patchesを1つ以上指定してください。");
      }
      if (!isPositiveNumber(objects.forces.rhoInf)) {
        errors.push("forces: rhoInfは正の数を指定してください。");
      }
      if (!isVector(objects.forces.CofR)) {
        errors.push("forces: CofRは数値3成分で指定してください。");
      }
    }

    if (objects.forceCoeffs?.enabled) {
      if (normalizeNameList(objects.forceCoeffs.patchNames).length === 0) {
        errors.push("forceCoeffs: patchesを1つ以上指定してください。");
      }
      for (const [key, value] of Object.entries({
        rhoInf: objects.forceCoeffs.rhoInf,
        magUInf: objects.forceCoeffs.magUInf,
        lRef: objects.forceCoeffs.lRef,
        Aref: objects.forceCoeffs.Aref,
      })) {
        if (!isPositiveNumber(value)) errors.push(`forceCoeffs: ${key}は正の数を指定してください。`);
      }
      for (const key of ["liftDir", "dragDir", "pitchAxis", "CofR"]) {
        if (!isVector(objects.forceCoeffs[key])) {
          errors.push(`forceCoeffs: ${key}は数値3成分で指定してください。`);
        }
      }
    }

    if (objects.wallHeatFlux?.enabled) {
      if (!sanitizeFoamWord(objects.wallHeatFlux.qr, "")) {
        errors.push("wallHeatFlux: qrはOpenFOAMのwordで指定してください。");
      }
    }

    if (objects.surfaceFieldValue?.enabled) {
      if (!sanitizeFoamWord(objects.surfaceFieldValue.patchName, "")) {
        errors.push("surfaceFieldValue: patchを指定してください。");
      }
      if (normalizeFields(objects.surfaceFieldValue.fields).length === 0) {
        errors.push("surfaceFieldValue: fieldsを1つ以上指定してください。");
      }
      if (!sanitizeFoamWord(objects.surfaceFieldValue.operation, "")) {
        errors.push("surfaceFieldValue: operationを指定してください。");
      }
    }

    if (objects.flowRatePatch?.enabled) {
      if (!sanitizeFoamWord(objects.flowRatePatch.patchName, "")) {
        errors.push("flowRatePatch: patchを指定してください。");
      }
      if (!sanitizeFoamWord(objects.flowRatePatch.phi, "")) {
        errors.push("flowRatePatch: flux fieldを指定してください。");
      }
    }

    if (objects.fieldMinMax?.enabled) {
      if (normalizeFields(objects.fieldMinMax.fields).length === 0) {
        errors.push("fieldMinMax: fieldsを1つ以上指定してください。");
      }
      if (!["magnitude", "component"].includes(String(objects.fieldMinMax.mode))) {
        errors.push("fieldMinMax: modeはmagnitudeまたはcomponentを指定してください。");
      }
    }
  }

  function buildPointProbes(state) {
    return block("pointProbes", [
      entry("type", "probes"),
      entry("libs", "(sampling)"),
      entry("fields", foamList(state.fields)),
      entry("writeControl", state.writeControl),
      entry("writeInterval", formatNumber(state.writeInterval)),
      entry("interpolationScheme", state.interpolationScheme),
      "        probeLocations",
      "        (",
      ...state.points.map((point) => `            ${formatVector(point.location)}    // ${point.name}`),
      "        );",
    ]);
  }

  function buildLineSamples(state) {
    return block("lineSamples", [
      entry("type", "sets"),
      entry("libs", "(sampling)"),
      entry("fields", foamList(state.fields)),
      entry("writeControl", state.writeControl),
      entry("writeInterval", formatNumber(state.writeInterval)),
      entry("interpolationScheme", state.interpolationScheme),
      entry("setFormat", "raw"),
      "        sets",
      "        (",
      ...state.lines.flatMap((line) => [
        `            ${line.name}`,
        "            {",
        "                type        uniform;",
        "                axis        distance;",
        `                start       ${formatVector(line.start)};`,
        `                end         ${formatVector(line.end)};`,
        `                nPoints     ${line.nPoints};`,
        "            }",
      ]),
      "        );",
    ]);
  }

  function buildPatchSamples(state) {
    return block("patchSamples", [
      entry("type", "surfaces"),
      entry("libs", "(sampling)"),
      entry("fields", foamList(state.fields)),
      entry("writeControl", state.writeControl),
      entry("writeInterval", formatNumber(state.writeInterval)),
      entry("interpolationScheme", state.interpolationScheme),
      entry("surfaceFormat", "raw"),
      "        surfaces",
      "        (",
      ...state.patches.flatMap((surface) => [
        `            ${surface.name}`,
        "            {",
        "                type        patch;",
        `                patches     ${foamList(surface.patchNames)};`,
        "            }",
      ]),
      "        );",
    ]);
  }

  function buildGeneralFunctionObjects(state) {
    const objects = state.functionObjects;
    const blocks = [];

    if (objects.forces.enabled) blocks.push(buildForces(objects.forces, state));
    if (objects.forceCoeffs.enabled) blocks.push(buildForceCoeffs(objects.forceCoeffs, state));
    if (objects.wallShearStress.enabled) blocks.push(buildWallShearStress(objects.wallShearStress, state));
    if (objects.wallHeatFlux.enabled) blocks.push(buildWallHeatFlux(objects.wallHeatFlux, state));
    if (objects.yPlus.enabled) blocks.push(buildYPlus(objects.yPlus, state));
    if (objects.surfaceFieldValue.enabled) blocks.push(buildSurfaceFieldValue(objects.surfaceFieldValue, state));
    if (objects.flowRatePatch.enabled) blocks.push(buildFlowRatePatch(objects.flowRatePatch, state));
    if (objects.fieldMinMax.enabled) blocks.push(buildFieldMinMax(objects.fieldMinMax, state));

    return blocks;
  }

  function buildForces(config, state) {
    return block(config.name, [
      entry("type", "forces"),
      entry("libs", "(forces)"),
      ...executionEntries(state),
      entry("log", formatBool(config.log)),
      entry("patches", foamList(config.patchNames)),
      entry("rho", "rhoInf"),
      entry("rhoInf", formatNumber(config.rhoInf)),
      entry("CofR", formatVector(config.CofR)),
    ]);
  }

  function buildForceCoeffs(config, state) {
    return block(config.name, [
      entry("type", "forceCoeffs"),
      entry("libs", "(forces)"),
      ...executionEntries(state),
      entry("log", formatBool(config.log)),
      entry("patches", foamList(config.patchNames)),
      entry("rho", "rhoInf"),
      entry("rhoInf", formatNumber(config.rhoInf)),
      entry("liftDir", formatVector(config.liftDir)),
      entry("dragDir", formatVector(config.dragDir)),
      entry("CofR", formatVector(config.CofR)),
      entry("pitchAxis", formatVector(config.pitchAxis)),
      entry("magUInf", formatNumber(config.magUInf)),
      entry("lRef", formatNumber(config.lRef)),
      entry("Aref", formatNumber(config.Aref)),
    ]);
  }

  function buildWallShearStress(config, state) {
    return block(config.name, [
      entry("type", "wallShearStress"),
      entry("libs", "(fieldFunctionObjects)"),
      ...executionEntries(state),
      ...(config.patchNames.length > 0 ? [entry("patches", foamList(config.patchNames))] : []),
      entry("writeFields", formatBool(config.writeFields)),
    ]);
  }

  function buildWallHeatFlux(config, state) {
    return block(config.name, [
      entry("type", "wallHeatFlux"),
      entry("libs", "(fieldFunctionObjects)"),
      ...executionEntries(state),
      ...(config.patchNames.length > 0 ? [entry("patches", foamList(config.patchNames))] : []),
      entry("qr", config.qr),
    ]);
  }

  function buildYPlus(config, state) {
    return block(config.name, [
      entry("type", "yPlus"),
      entry("libs", "(fieldFunctionObjects)"),
      ...executionEntries(state),
      entry("useWallFunction", formatBool(config.useWallFunction)),
      entry("writeFields", formatBool(config.writeFields)),
    ]);
  }

  function buildSurfaceFieldValue(config, state) {
    return block(config.name, [
      entry("type", "surfaceFieldValue"),
      entry("libs", "(fieldFunctionObjects)"),
      ...executionEntries(state),
      entry("log", formatBool(config.log)),
      entry("regionType", "patch"),
      entry("name", config.patchName),
      entry("fields", foamList(config.fields)),
      entry("operation", config.operation),
      entry("writeArea", formatBool(config.writeArea)),
      entry("writeFields", formatBool(config.writeFields)),
      entry("surfaceFormat", config.surfaceFormat),
    ]);
  }

  function buildFlowRatePatch(config, state) {
    return block(config.name, [
      entry("type", "surfaceFieldValue"),
      entry("libs", "(fieldFunctionObjects)"),
      ...executionEntries(state),
      entry("log", formatBool(config.log)),
      entry("regionType", "patch"),
      entry("name", config.patchName),
      entry("fields", foamList([config.phi])),
      entry("operation", "sum"),
    ]);
  }

  function buildFieldMinMax(config, state) {
    return block(config.name, [
      entry("type", "fieldMinMax"),
      entry("libs", "(fieldFunctionObjects)"),
      ...executionEntries(state),
      entry("log", formatBool(config.log)),
      entry("fields", foamList(config.fields)),
      entry("mode", config.mode),
      entry("location", formatBool(config.location)),
    ]);
  }

  function executionEntries(state) {
    return [
      entry("writeControl", state.writeControl),
      entry("writeInterval", formatNumber(state.writeInterval)),
      entry("executeControl", state.writeControl),
      entry("executeInterval", formatNumber(state.writeInterval)),
    ];
  }

  function block(name, lines) {
    return [
      `    ${name}`,
      "    {",
      ...lines,
      "    }",
    ].join("\n");
  }

  function entry(key, value) {
    return `        ${key.padEnd(20, " ")}${value};`;
  }

  function joinBlocks(blocks) {
    return blocks.flatMap((item, index) => (index === 0 ? [item] : ["", item]));
  }

  function normalizeNameList(value) {
    const names = Array.isArray(value)
      ? value
      : String(value ?? "")
          .split(/[\s,]+/)
          .filter(Boolean);

    return [...new Set(names.map((name) => sanitizeFoamWord(name, "")).filter(Boolean))];
  }

  function foamList(items) {
    return `(${items.join(" ")})`;
  }

  function formatVector(vector) {
    return `(${normalizeVector(vector).map(formatNumber).join(" ")})`;
  }

  function normalizeVector(vector) {
    return [Number(vector[0]), Number(vector[1]), Number(vector[2])];
  }

  function vectorOrDefault(value, fallback) {
    return isVector(value) ? normalizeVector(value) : [...fallback];
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || Object.is(number, -0)) return "0";
    return String(number);
  }

  function positiveNumberOrDefault(value, fallback) {
    return isPositiveNumber(value) ? Number(value) : fallback;
  }

  function formatBool(value) {
    return value ? "yes" : "no";
  }

  function boolOrDefault(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "on", "1"].includes(normalized)) return true;
      if (["false", "no", "off", "0"].includes(normalized)) return false;
    }
    return fallback;
  }

  function isVector(value) {
    return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)));
  }

  function isPositiveNumber(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function arrayOrEmpty(value) {
    return Array.isArray(value) ? value : [];
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  const api = {
    buildFunctionsBlock,
    createDefaultState,
    normalizeFields,
    sanitizeFoamWord,
    validateSamplingState,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.OpenFoamSampling = api;
  }
})(globalThis);

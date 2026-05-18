const el = (id) => document.getElementById(id);

const state = {
  mode: "generate",
  provider: "",
  model: "",
  quality: "",
  inputDataUrl: "",
  outputImgEl: null,
  outputDataUrl: "",
  busy: false,
};

const ui = {
  btnSignIn: el("btnSignIn"),
  btnSignOut: el("btnSignOut"),
  tabGenerate: el("tabGenerate"),
  tabEdit: el("tabEdit"),
  status: el("status"),
  selProvider: el("selProvider"),
  selModel: el("selModel"),
  selQuality: el("selQuality"),
  fileInput: el("fileInput"),
  inputHint: el("inputHint"),
  txtPrompt: el("txtPrompt"),
  btnRun: el("btnRun"),
  btnResetInput: el("btnResetInput"),
  imgBox: el("imgBox"),
  imgPlaceholder: el("imgPlaceholder"),
  btnDownload: el("btnDownload"),
  btnUseAsInput: el("btnUseAsInput"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(text, kind) {
  if (kind === "error") ui.status.innerHTML = `<strong>Fehler:</strong> ${escapeHtml(text)}`;
  else if (kind === "ok") ui.status.innerHTML = `<strong>OK:</strong> ${escapeHtml(text)}`;
  else ui.status.textContent = text;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setBusy(busy) {
  state.busy = busy;
  ui.btnRun.disabled = busy || !state.provider || !state.model;
  ui.btnSignIn.disabled = busy;
  ui.btnSignOut.disabled = busy;
  ui.selProvider.disabled = busy;
  ui.selModel.disabled = busy;
  ui.selQuality.disabled = busy;
  ui.btnResetInput.disabled = busy || !state.inputDataUrl;
  ui.btnDownload.disabled = busy || !state.outputDataUrl;
  ui.btnUseAsInput.disabled = busy || !state.outputDataUrl;
}

function setMode(mode) {
  state.mode = mode;
  ui.tabGenerate.classList.toggle("active", mode === "generate");
  ui.tabEdit.classList.toggle("active", mode === "edit");

  if (mode === "edit") {
    ui.fileInput.classList.remove("hide");
    ui.inputHint.classList.add("hide");
    ui.btnResetInput.disabled = !state.inputDataUrl;
  } else {
    ui.fileInput.classList.add("hide");
    ui.inputHint.classList.remove("hide");
    ui.btnResetInput.disabled = true;
  }
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function imgSrcToDataUrl(src) {
  const res = await fetch(src);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function setOutputImage(imgEl) {
  state.outputImgEl = imgEl;

  ui.imgBox.innerHTML = "";
  ui.imgBox.appendChild(imgEl);

  ui.btnDownload.disabled = true;
  ui.btnUseAsInput.disabled = true;

  queueMicrotask(async () => {
    try {
      const src = imgEl.getAttribute("src") || "";
      if (!src) return;
      state.outputDataUrl = src.startsWith("data:") ? src : await imgSrcToDataUrl(src);
      ui.btnDownload.disabled = false;
      ui.btnUseAsInput.disabled = false;
    } catch (e) {
      state.outputDataUrl = "";
      ui.btnDownload.disabled = true;
      ui.btnUseAsInput.disabled = true;
    }
  });
}

function setInputDataUrl(dataUrl) {
  state.inputDataUrl = dataUrl;
  ui.btnResetInput.disabled = !dataUrl || state.mode !== "edit";
}

function populateSelect(select, items, getLabel, getValue) {
  select.innerHTML = "";
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = getValue(it);
    opt.textContent = getLabel(it);
    select.appendChild(opt);
  }
}

async function ensurePuterReady() {
  for (let i = 0; i < 200; i++) {
    if (window.puter && window.puter.ai && window.puter.auth) return;
    await sleep(50);
  }
  throw new Error("Puter.js konnte nicht geladen werden.");
}

async function refreshAuthUi() {
  const signedIn = await window.puter.auth.isSignedIn();
  ui.btnSignIn.disabled = signedIn || state.busy;
  ui.btnSignOut.disabled = !signedIn || state.busy;
  ui.btnRun.disabled = state.busy || !signedIn || !state.provider || !state.model;

  if (!signedIn) {
    setStatus("Nicht angemeldet. Tippe auf „Anmelden“.", "error");
    return;
  }

  try {
    const user = await window.puter.auth.getUser();
    const usage = await window.puter.auth.getMonthlyUsage();
    const name = user?.username || user?.name || "User";
    const used = usage?.used ?? usage?.usage ?? "";
    const limit = usage?.limit ?? usage?.max ?? "";
    const usageText = used && limit ? ` · Nutzung: ${used}/${limit}` : "";
    setStatus(`Angemeldet als ${name}${usageText}`, "ok");
  } catch (e) {
    setStatus("Angemeldet.", "ok");
  }
}

function normalizeProviders(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (typeof result === "object") {
    const vals = Object.values(result);
    if (vals.every((v) => typeof v === "string")) return vals;
    return vals;
  }
  return [];
}

function normalizeModels(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (typeof result === "object") return Object.values(result).flat();
  return [];
}

function modelId(m) {
  return m?.id || m?.name || m?.model || String(m);
}

function modelLabel(m) {
  const id = modelId(m);
  const cost = m?.cost ?? m?.price ?? "";
  return cost ? `${id} (${cost})` : id;
}

async function loadProvidersAndModels() {
  setBusy(true);
  try {
    const providersRaw = await window.puter.ai.listModelProviders();
    const providers = normalizeProviders(providersRaw).map((p) => (typeof p === "string" ? { id: p } : p));
    if (!providers.length) throw new Error("Keine Provider gefunden.");

    populateSelect(ui.selProvider, providers, (p) => p.id || p.name, (p) => p.id || p.name);
    ui.selProvider.disabled = false;

    state.provider = ui.selProvider.value;
    await loadModelsForProvider(state.provider);
  } finally {
    setBusy(false);
  }
}

async function loadModelsForProvider(provider) {
  setBusy(true);
  try {
    const signedIn = await window.puter.auth.isSignedIn();
    if (!signedIn) return;

    const modelsRaw = await window.puter.ai.listModels(provider);
    const models = normalizeModels(modelsRaw);
    if (!models.length) throw new Error("Keine Modelle gefunden.");

    populateSelect(ui.selModel, models, modelLabel, modelId);
    ui.selModel.disabled = false;
    state.model = ui.selModel.value;
    ui.btnRun.disabled = state.busy || !state.provider || !state.model || !signedIn;
  } finally {
    setBusy(false);
  }
}

function buildOptions() {
  const options = {};
  if (state.provider) options.provider = state.provider;
  if (state.model) options.model = state.model;
  if (state.quality) options.quality = state.quality;

  if (state.mode === "edit" && state.inputDataUrl) {
    const base64 = state.inputDataUrl.split(",")[1] || "";
    if (state.provider === "gemini") options.input_images = [base64];
    else options.image_base64 = base64;
  }

  return options;
}

async function run() {
  if (state.busy) return;

  const signedIn = await window.puter.auth.isSignedIn();
  if (!signedIn) {
    await refreshAuthUi();
    return;
  }

  const prompt = ui.txtPrompt.value.trim();
  if (!prompt) {
    setStatus("Bitte einen Prompt eingeben.", "error");
    return;
  }

  if (state.mode === "edit" && !state.inputDataUrl) {
    setStatus("Bitte ein Eingabebild auswählen oder „Als Input nutzen“ drücken.", "error");
    return;
  }

  setBusy(true);
  setStatus("Arbeite…");
  try {
    const imgEl = await window.puter.ai.txt2img(prompt, buildOptions());
    if (!imgEl || !imgEl.getAttribute) throw new Error("Unerwartete Antwort vom Modell.");
    setOutputImage(imgEl);
    setStatus("Fertig.", "ok");
  } catch (e) {
    setStatus(e?.message || String(e), "error");
  } finally {
    setBusy(false);
  }
}

function downloadFromWeb(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadImage() {
  if (!state.outputDataUrl) return;
  const fileName = `puter_ai_${Date.now()}.png`;

  if (window.AndroidBridge && typeof window.AndroidBridge.saveImage === "function") {
    window.AndroidBridge.saveImage(fileName, state.outputDataUrl);
    setStatus(`Gespeichert: Downloads/PuterAI/${fileName}`, "ok");
    return;
  }

  downloadFromWeb(state.outputDataUrl, fileName);
}

async function useAsInput() {
  if (!state.outputDataUrl) return;
  setMode("edit");
  setInputDataUrl(state.outputDataUrl);
  setStatus("Output als Input gesetzt.", "ok");
}

function resetInput() {
  setInputDataUrl("");
  ui.fileInput.value = "";
  setStatus("Input gelöscht.", "ok");
}

function attachUi() {
  ui.tabGenerate.addEventListener("click", () => setMode("generate"));
  ui.tabEdit.addEventListener("click", () => setMode("edit"));

  ui.btnSignIn.addEventListener("click", async () => {
    setBusy(true);
    try {
      await window.puter.auth.signIn();
      await refreshAuthUi();
      await loadProvidersAndModels();
    } catch (e) {
      setStatus(e?.message || String(e), "error");
    } finally {
      setBusy(false);
    }
  });

  ui.btnSignOut.addEventListener("click", async () => {
    setBusy(true);
    try {
      await window.puter.auth.signOut();
      await refreshAuthUi();
    } catch (e) {
      setStatus(e?.message || String(e), "error");
    } finally {
      setBusy(false);
    }
  });

  ui.selProvider.addEventListener("change", async () => {
    state.provider = ui.selProvider.value;
    await loadModelsForProvider(state.provider);
  });

  ui.selModel.addEventListener("change", () => {
    state.model = ui.selModel.value;
    refreshAuthUi();
  });

  ui.selQuality.addEventListener("change", () => {
    state.quality = ui.selQuality.value;
  });

  ui.fileInput.addEventListener("change", async () => {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setInputDataUrl(dataUrl);
    setStatus("Input-Bild geladen.", "ok");
  });

  ui.btnRun.addEventListener("click", run);
  ui.btnDownload.addEventListener("click", downloadImage);
  ui.btnUseAsInput.addEventListener("click", useAsInput);
  ui.btnResetInput.addEventListener("click", resetInput);
}

async function boot() {
  attachUi();

  try {
    await ensurePuterReady();
    const signedIn = await window.puter.auth.isSignedIn();
    ui.selQuality.disabled = false;
    if (signedIn) {
      await refreshAuthUi();
      await loadProvidersAndModels();
    } else {
      setStatus("Nicht angemeldet. Tippe auf „Anmelden“.", "error");
      ui.btnRun.disabled = true;
    }
  } catch (e) {
    setStatus(e?.message || String(e), "error");
  }
}

boot();


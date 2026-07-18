"use strict";

import { configured, initCloud, cloud } from "./cloud.js";

const STORAGE_KEY = "websites-with-whimsy-board-v1";
const NOTE_COLORS = { yellow: "#ffe681", pink: "#ffc4d5", blue: "#bde8ee" };

const defaultBoard = () => ({
  version: 2,
  themeId: "bulletin-board",
  profile: { name: "", headline: "", introduction: "" },
  blocks: [],
  archive: { visible: true, items: [] }
});

const storageAdapter = {
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || ![1, 2].includes(saved.version) || !Array.isArray(saved.blocks)) return defaultBoard();
      const clean = defaultBoard();
      clean.themeId = typeof saved.themeId === "string" ? saved.themeId : clean.themeId;
      for (const key of Object.keys(clean.profile)) clean.profile[key] = String(saved.profile?.[key] || "");
      clean.blocks = saved.blocks.filter(block => block && block.id && blockTypes[block.type]).map(sanitizeBlock);
      clean.archive.visible = saved.archive?.visible !== false;
      clean.archive.items = Array.isArray(saved.archive?.items)
        ? saved.archive.items.filter(block => block && block.id && blockTypes[block.type]).map(block => ({ ...sanitizeBlock(block), archived: true, visibility: block.visibility === "private" ? "private" : "public" }))
        : [];
      return clean;
    } catch (error) {
      console.warn("Could not restore the saved board.", error);
      return defaultBoard();
    }
  },
  save(board) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    } catch (error) {
      showToast("Your changes could not be saved. Browser storage may be full.");
      console.warn("Could not save board.", error);
    }
  },
  clear() { localStorage.removeItem(STORAGE_KEY); }
};

// Runtime file URLs deliberately live outside the saved content model.
// A future adapter can replace these object URLs with Supabase Storage references.
const mediaAdapter = {
  runtime: new Map(),
  async prepare(blockId, file) {
    if (!file) return { error: "Choose an image or video file." };
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
    if (!kind) return { error: "That file type is not supported. Choose a common image or browser-supported video." };
    if (!file.type) return { error: "The browser could not identify that file type." };

    const url = URL.createObjectURL(file);
    if (kind === "image") {
      const supported = await canLoadMedia("img", url);
      if (!supported) { URL.revokeObjectURL(url); return { error: "This image format is not supported by your browser." }; }
      this.set(blockId, { url, kind, file });
      return { kind, name: file.name, mimeType: file.type, duration: null, persistence: "session-only" };
    }

    const result = await readVideoMetadata(url);
    if (result.error) { URL.revokeObjectURL(url); return { error: "This video format cannot be played by your browser." }; }
    if (result.duration > 10.25) {
      URL.revokeObjectURL(url);
      return { error: `This video is ${result.duration.toFixed(1)} seconds long. Please choose a clip around 10 seconds or shorter.` };
    }
    this.set(blockId, { url, kind, file });
    return { kind, name: file.name, mimeType: file.type, duration: result.duration, persistence: "session-only" };
  },
  set(blockId, item) { this.release(blockId); this.runtime.set(blockId, { ...item, revoke: true }); },
  setRemote(blockId, item) { this.release(blockId); this.runtime.set(blockId, { ...item, revoke: false }); },
  get(blockId) { return this.runtime.get(blockId); },
  release(blockId) { const item = this.runtime.get(blockId); if (item?.revoke) URL.revokeObjectURL(item.url); this.runtime.delete(blockId); },
  releaseAll() { for (const id of [...this.runtime.keys()]) this.release(id); }
};

function canLoadMedia(tag, url) {
  return new Promise(resolve => {
    const element = document.createElement(tag);
    element.onload = () => resolve(true);
    element.onerror = () => resolve(false);
    element.src = url;
  });
}

function readVideoMetadata(url) {
  return new Promise(resolve => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({ duration: video.duration });
    video.onerror = () => resolve({ error: true });
    video.src = url;
  });
}

function uniqueId() {
  return globalThis.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function textNote() {
  return { id: uniqueId(), type: "text-note", title: "", text: "", color: "yellow", buttonText: "", buttonLink: "" };
}

function mediaNote() {
  return { id: uniqueId(), type: "media-note", title: "", media: null, caption: "", buttonText: "", buttonLink: "" };
}

function sanitizeBlock(block) {
  if (block.type === "text-note") return {
    id: String(block.id), type: "text-note", title: String(block.title || ""), text: String(block.text || ""),
    color: NOTE_COLORS[block.color] ? block.color : "yellow", buttonText: String(block.buttonText || ""), buttonLink: String(block.buttonLink || "")
  };
  const media = block.media && typeof block.media === "object" ? {
    kind: block.media.kind === "video" ? "video" : "image", name: String(block.media.name || ""),
    mimeType: String(block.media.mimeType || ""), altText: String(block.media.altText || ""),
    duration: Number.isFinite(block.media.duration) ? block.media.duration : null,
    storagePath: String(block.media.storagePath || ""), persistence: block.media.storagePath ? "cloud" : "session-only"
  } : null;
  return { id: String(block.id), type: "media-note", title: String(block.title || ""), media, caption: String(block.caption || ""), buttonText: String(block.buttonText || ""), buttonLink: String(block.buttonLink || "") };
}

function safeLink(value) {
  const input = value.trim();
  if (!input) return null;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(input)) return input;
  try {
    const url = new URL(input);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

const els = {
  profile: document.querySelector("#profile-form"), editors: document.querySelector("#block-editors"),
  preview: document.querySelector("#board-preview"), count: document.querySelector("#block-count"),
  dialog: document.querySelector("#block-dialog"), add: document.querySelector("#add-block"),
  reset: document.querySelector("#reset-board"), toast: document.querySelector("#toast"),
  authScreen: document.querySelector("#auth-screen"), appShell: document.querySelector("#app-shell"),
  authForm: document.querySelector("#auth-form"), authMessage: document.querySelector("#auth-message"),
  saveStatus: document.querySelector("#save-status"), boardsDialog: document.querySelector("#boards-dialog"),
  boardsList: document.querySelector("#boards-list"), importDialog: document.querySelector("#import-dialog")
};

const blockTypes = {
  "text-note": { label: "Text Post-It", create: textNote, editor: renderTextEditor, preview: renderTextPreview },
  "media-note": { label: "Media Post-It", create: mediaNote, editor: renderMediaEditor, preview: renderMediaPreview }
};
const themes = { "bulletin-board": { render: renderBulletinBoard } };
let board = storageAdapter.load();
let toastTimer;
let authMode = "signin";
let currentUser = null;
let currentBoardId = null;
let boardRows = [];
let currentBoardMeta = { boardName: "", status: "draft", isPublic: false };
let saveTimer = null;
let savePromise = null;
let boardDirty = false;
let authTransition = null;

function escapeHtml(value) {
  const div = document.createElement("div"); div.textContent = value;
  return div.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fieldHtml(block, key, label, options = {}) {
  const id = `${key}-${block.id}`;
  const value = escapeHtml(block[key] || "");
  const placeholder = options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : "";
  const control = options.textarea
    ? `<textarea id="${id}" data-field="${key}" rows="3" maxlength="${options.max || 160}"${placeholder}>${value}</textarea>`
    : `<input id="${id}" data-field="${key}" type="${options.type || "text"}" maxlength="${options.max || 160}" value="${value}"${placeholder}>`;
  return `<div class="field"><label for="${id}">${label}</label>${control}</div>`;
}

function linkFields(block) {
  const invalid = block.buttonLink.trim() && !safeLink(block.buttonLink);
  return `<div class="field"><label for="buttonText-${block.id}">Button text</label><input id="buttonText-${block.id}" data-field="buttonText" type="text" maxlength="50" value="${escapeHtml(block.buttonText)}" placeholder="e.g. Visit my shop"></div>
    <div class="field"><label for="buttonLink-${block.id}">Button link</label><input id="buttonLink-${block.id}" data-field="buttonLink" type="url" maxlength="500" value="${escapeHtml(block.buttonLink)}" placeholder="https://example.com or mailto:hello@example.com" aria-invalid="${invalid}" aria-describedby="linkError-${block.id}"><p id="linkError-${block.id}" class="${invalid ? "error-text" : "help-text"}">${invalid ? "Enter a complete http://, https://, or mailto: link. The preview button is hidden until it is valid." : "The preview button appears when both fields are complete and the link is valid."}</p></div>`;
}

function editorShell(block, fields) {
  return `<details class="block-editor" data-block-id="${block.id}" open><summary><span>${escapeHtml(block.title || "Untitled Post-It")}</span><span class="block-type">${blockTypes[block.type].label}</span></summary><div class="editor-fields">${fields}<div class="editor-actions"><button class="archive-button" type="button" data-archive aria-label="Archive ${blockTypes[block.type].label}${block.title ? ` titled ${escapeHtml(block.title)}` : ""}">Archive</button><button class="delete-button" type="button" data-delete aria-label="Delete ${blockTypes[block.type].label}${block.title ? ` titled ${escapeHtml(block.title)}` : ""}">Delete Post-It</button></div></div></details>`;
}

function renderTextEditor(block) {
  const colors = Object.keys(NOTE_COLORS).map(color => `<span class="color-choice"><input id="color-${color}-${block.id}" name="color-${block.id}" data-field="color" type="radio" value="${color}" ${block.color === color ? "checked" : ""}><label for="color-${color}-${block.id}" style="--swatch:${NOTE_COLORS[color]}">${color[0].toUpperCase() + color.slice(1)}</label></span>`).join("");
  return editorShell(block, `${fieldHtml(block, "title", "Title", { max: 80 })}${fieldHtml(block, "text", "Short text", { textarea: true, max: 400 })}<fieldset class="color-options"><legend class="fieldset-label">Note color</legend>${colors}</fieldset>${linkFields(block)}`);
}

function renderMediaEditor(block) {
  const mediaStatus = block.media ? `${escapeHtml(block.media.name)}${mediaAdapter.get(block.id) ? " — saved and ready" : block.media.storagePath ? " — loading saved media" : " — select this file again to upload it"}` : "No file selected.";
  const alt = block.media?.altText || "";
  return editorShell(block, `${fieldHtml(block, "title", "Title", { max: 80 })}<div class="field"><label for="media-${block.id}">Image or video clip</label><input id="media-${block.id}" data-media type="file" accept="image/*,video/*" aria-describedby="mediaHelp-${block.id} mediaError-${block.id}"><p id="mediaHelp-${block.id}" class="help-text">Choose a common image or a browser-supported video around 10 seconds or shorter. ${mediaStatus}</p><p id="mediaError-${block.id}" class="error-text" aria-live="polite"></p></div><div class="field"><label for="altText-${block.id}">Media description</label><input id="altText-${block.id}" data-media-field="altText" type="text" maxlength="180" value="${escapeHtml(alt)}" placeholder="Describe the image or video for visitors"><p class="help-text">A short description helps people using screen readers.</p></div>${fieldHtml(block, "caption", "Caption", { textarea: true, max: 280 })}${linkFields(block)}`);
}

function renderLink(block) {
  const href = safeLink(block.buttonLink);
  if (!block.buttonText.trim() || !href) return "";
  const external = href.startsWith("http") ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<a class="note-link" href="${escapeHtml(href)}"${external}>${escapeHtml(block.buttonText)}</a>`;
}

function renderTextPreview(block) {
  return `<article class="note note--text" style="--note-color:${NOTE_COLORS[block.color]}"><h3>${escapeHtml(block.title || "A little note")}</h3>${block.text ? `<p>${escapeHtml(block.text)}</p>` : ""}${renderLink(block)}</article>`;
}

function renderMediaPreview(block) {
  const runtime = mediaAdapter.get(block.id);
  let mediaHtml = `<div class="media-placeholder" role="img" aria-label="Media not available">${block.media?.storagePath ? "Loading saved media…" : block.media ? "Select this file again to upload it permanently." : "Your image or short video will appear here."}</div>`;
  if (runtime?.kind === "image") mediaHtml = `<img class="note-media" src="${runtime.url}" alt="${escapeHtml(block.media?.altText || block.caption || "Uploaded image")}">`;
  if (runtime?.kind === "video") mediaHtml = `<video class="note-media" src="${runtime.url}" aria-label="${escapeHtml(block.media?.altText || block.caption || "Uploaded video")}" autoplay muted loop playsinline></video>`;
  return `<article class="note note--media" style="--note-color:${NOTE_COLORS.blue}"><h3>${escapeHtml(block.title || "A moment to share")}</h3>${mediaHtml}${block.caption ? `<p class="caption">${escapeHtml(block.caption)}</p>` : ""}${renderLink(block)}</article>`;
}

function renderBulletinBoard() {
  const profile = board.profile;
  const notes = board.blocks.length ? board.blocks.map(block => blockTypes[block.type].preview(block)).join("") : document.querySelector("#empty-state-template").innerHTML;
  els.preview.innerHTML = `${renderArchiveFolder()}<div class="profile-card"><h3>${escapeHtml(profile.name || "Your Name")}</h3><p class="headline">${escapeHtml(profile.headline || "Your headline goes here")}</p>${profile.introduction ? `<p class="introduction">${escapeHtml(profile.introduction)}</p>` : ""}</div><div class="notes-grid">${notes}</div>`;
}

function archiveItemPreview(block) {
  if (block.type === "text-note") return block.text ? `<p>${escapeHtml(block.text.slice(0, 90))}${block.text.length > 90 ? "…" : ""}</p>` : "";
  const runtime = mediaAdapter.get(block.id);
  if (runtime?.kind === "image") return `<img src="${runtime.url}" alt="${escapeHtml(block.media?.altText || "Archived image preview")}">`;
  if (runtime?.kind === "video") return `<video src="${runtime.url}" aria-label="${escapeHtml(block.media?.altText || "Archived video preview")}" autoplay muted loop playsinline></video>`;
  return block.caption ? `<p>${escapeHtml(block.caption.slice(0, 90))}${block.caption.length > 90 ? "…" : ""}</p>` : "";
}

function renderArchiveFolder() {
  const items = board.archive.items.map(block => `<li class="archive-item" data-archive-id="${block.id}">
    <div class="archive-item-heading"><div><strong>${escapeHtml(block.title || "Untitled Post-It")}</strong><span>${blockTypes[block.type].label}</span></div>${archiveItemPreview(block)}</div>
    <fieldset class="archive-visibility"><legend>Visibility</legend><label><input type="radio" name="visibility-${block.id}" value="public" ${block.visibility !== "private" ? "checked" : ""}> Public</label><label><input type="radio" name="visibility-${block.id}" value="private" ${block.visibility === "private" ? "checked" : ""}> Private</label></fieldset>
    <div class="archive-item-actions"><button type="button" data-restore>Restore</button><button type="button" data-delete-archived>Delete Permanently</button></div>
  </li>`).join("");
  return `<aside class="archive-folder" aria-label="Archive folder">
    <button class="archive-folder-tab" type="button" aria-expanded="false" data-toggle-archive><span class="archive-label">Archive</span><span class="archive-total">${board.archive.items.length}</span></button>
    <div class="archive-folder-contents" aria-hidden="true">
      <div class="archive-folder-heading"><h3>Archive</h3><button type="button" class="archive-close" data-toggle-archive aria-label="Close Archive folder">×</button></div>
      <p class="archive-empty" ${board.archive.items.length ? "hidden" : ""}>Archived Post-Its will rest here.</p>
      <ul class="archive-list">${items}</ul>
      <details class="archive-settings"><summary>Settings</summary><fieldset><legend>Archive folder on my public board</legend><label><input type="radio" name="archive-visible" value="show" ${board.archive.visible ? "checked" : ""}> Show Archive Folder</label><label><input type="radio" name="archive-visible" value="hide" ${!board.archive.visible ? "checked" : ""}> Hide Archive Folder</label><p>This preference is saved for future publishing. The folder remains visible while you edit.</p></fieldset></details>
    </div>
  </aside>`;
}

function renderEditors() {
  const openIds = new Set([...els.editors.querySelectorAll("details[open]")].map(el => el.dataset.blockId));
  els.editors.innerHTML = board.blocks.map(block => blockTypes[block.type].editor(block)).join("");
  if (openIds.size) els.editors.querySelectorAll("details").forEach(el => { el.open = openIds.has(el.dataset.blockId); });
  els.count.textContent = `${board.blocks.length} Post-It${board.blocks.length === 1 ? "" : "s"}`;
}

function renderAll() { renderEditors(); themes[board.themeId].render(); }
function persistBoard() {
  if (!currentUser || !currentBoardId) return;
  boardDirty = true;
  setSaveState("Saving...");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(), 800);
}

function saveAndPreview() { persistBoard(); themes[board.themeId].render(); }

function setSaveState(text, isError = false) {
  els.saveStatus.textContent = text;
  els.saveStatus.classList.toggle("is-error", isError);
  els.saveStatus.classList.toggle("is-saving", text === "Saving...");
}

async function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!currentBoardId || !boardDirty) return true;
  if (savePromise) { await savePromise; if (boardDirty) return flushSave(); return true; }
  boardDirty = false; setSaveState("Saving...");
  savePromise = cloud.saveBoard(currentBoardId, {
    board_name: currentBoardMeta.boardName || "Untitled Board", theme_id: board.themeId, board_data: board,
    status: currentBoardMeta.status, is_public: currentBoardMeta.isPublic
  });
  try { await savePromise; setSaveState("Saved"); return true; }
  catch (error) { boardDirty = true; setSaveState("Error saving — Retry", true); console.error(error); return false; }
  finally { savePromise = null; }
}

function showToast(message) {
  clearTimeout(toastTimer); els.toast.textContent = message; els.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 3200);
}

function openChooser() { els.dialog.showModal(); }
els.add.addEventListener("click", openChooser);
els.preview.addEventListener("click", event => { if (event.target.closest("[data-empty-add]")) openChooser(); });
document.querySelectorAll("[data-add-type]").forEach(button => button.addEventListener("click", () => {
  const definition = blockTypes[button.dataset.addType];
  if (!definition) return;
  board.blocks.push(definition.create()); persistBoard(); els.dialog.close(); renderAll();
  const editor = els.editors.lastElementChild;
  if (editor) editor.open = true;
  editor?.scrollIntoView({ behavior: "smooth", block: "nearest" }); editor?.querySelector("input")?.focus();
}));

els.profile.addEventListener("input", event => {
  if (!(event.target.name in board.profile)) return;
  board.profile[event.target.name] = event.target.value; saveAndPreview();
});

els.editors.addEventListener("input", event => {
  const editor = event.target.closest("[data-block-id]");
  const block = board.blocks.find(item => item.id === editor?.dataset.blockId);
  if (!block) return;
  const field = event.target.dataset.field;
  if (field) {
    block[field] = event.target.value; persistBoard(); themes[board.themeId].render();
    if (field === "title") {
      editor.querySelector("summary > span").textContent = block.title || "Untitled Post-It";
      const deleteButton = editor.querySelector("[data-delete]");
      deleteButton.setAttribute("aria-label", `Delete ${blockTypes[block.type].label}${block.title ? ` titled ${block.title}` : ""}`);
      const archiveButton = editor.querySelector("[data-archive]");
      archiveButton.setAttribute("aria-label", `Archive ${blockTypes[block.type].label}${block.title ? ` titled ${block.title}` : ""}`);
    }
    if (field === "buttonLink") {
      const invalid = block.buttonLink.trim() && !safeLink(block.buttonLink);
      event.target.setAttribute("aria-invalid", String(Boolean(invalid)));
      const message = editor.querySelector(`#linkError-${CSS.escape(block.id)}`);
      message.className = invalid ? "error-text" : "help-text";
      message.textContent = invalid ? "Enter a complete http://, https://, or mailto: link. The preview button is hidden until it is valid." : "The preview button appears when both fields are complete and the link is valid.";
    }
  }
  if (event.target.dataset.mediaField) {
    block.media ||= { kind: "image", name: "", mimeType: "", altText: "", duration: null, persistence: "session-only" };
    block.media[event.target.dataset.mediaField] = event.target.value; saveAndPreview();
  }
});

els.editors.addEventListener("change", async event => {
  if (!event.target.matches("[data-media]")) return;
  const editor = event.target.closest("[data-block-id]");
  const block = board.blocks.find(item => item.id === editor.dataset.blockId);
  const errorEl = editor.querySelector(`#mediaError-${CSS.escape(block.id)}`);
  errorEl.textContent = "Checking file…";
  const result = await mediaAdapter.prepare(block.id, event.target.files[0]);
  if (result.error) { errorEl.textContent = result.error; event.target.value = ""; return; }
  try {
    errorEl.textContent = "Uploading securely…";
    const oldPath = block.media?.storagePath;
    const storagePath = await cloud.uploadMedia(currentUser.id, currentBoardId, block.id, event.target.files[0]);
    block.media = { ...result, storagePath, persistence: "cloud", altText: block.media?.altText || "" };
    if (oldPath) cloud.removeMedia(oldPath).catch(console.warn);
    persistBoard(); renderEditors(); themes[board.themeId].render(); showToast("Media uploaded and attached to this board.");
  } catch (error) {
    mediaAdapter.release(block.id); errorEl.textContent = `Upload failed: ${error.message}`; setSaveState("Error saving — Retry", true);
  }
});

els.editors.addEventListener("click", event => {
  const archiveButton = event.target.closest("[data-archive]");
  if (archiveButton) {
    const editor = archiveButton.closest("[data-block-id]");
    const block = board.blocks.find(item => item.id === editor.dataset.blockId);
    if (!block) return;
    board.blocks = board.blocks.filter(item => item.id !== block.id);
    board.archive.items.unshift({ ...block, archived: true, visibility: "public" });
    persistBoard(); renderAll(); showToast("Post-It moved to Archive.");
    return;
  }
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  const editor = button.closest("[data-block-id]");
  const block = board.blocks.find(item => item.id === editor.dataset.blockId);
  if (!block || !confirm(`Delete this ${blockTypes[block.type].label}? This cannot be undone.`)) return;
  mediaAdapter.release(block.id); if (block.media?.storagePath) cloud.removeMedia(block.media.storagePath).catch(console.warn); board.blocks = board.blocks.filter(item => item.id !== block.id); persistBoard(); renderAll(); showToast("Post-It deleted.");
});

els.preview.addEventListener("click", event => {
  const toggle = event.target.closest("[data-toggle-archive]");
  if (toggle) {
    const folder = toggle.closest(".archive-folder");
    const contents = folder.querySelector(".archive-folder-contents");
    const isOpen = folder.classList.contains("is-open");
    folder.classList.toggle("is-open", !isOpen);
    contents.setAttribute("aria-hidden", String(isOpen));
    folder.querySelector(".archive-folder-tab").setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) folder.querySelector(".archive-close").focus();
    else folder.querySelector(".archive-folder-tab").focus();
    return;
  }
  const itemElement = event.target.closest("[data-archive-id]");
  if (!itemElement) return;
  const block = board.archive.items.find(item => item.id === itemElement.dataset.archiveId);
  if (!block) return;
  if (event.target.closest("[data-restore]")) {
    board.archive.items = board.archive.items.filter(item => item.id !== block.id);
    const { archived, visibility, ...activeBlock } = block;
    board.blocks.push(activeBlock); persistBoard(); renderAll(); showToast("Post-It restored to your board.");
  }
  if (event.target.closest("[data-delete-archived]") && confirm(`Permanently delete “${block.title || "Untitled Post-It"}”? This cannot be undone.`)) {
    mediaAdapter.release(block.id); board.archive.items = board.archive.items.filter(item => item.id !== block.id);
    if (block.media?.storagePath) cloud.removeMedia(block.media.storagePath).catch(console.warn);
    persistBoard(); renderAll(); showToast("Archived Post-It permanently deleted.");
  }
});

els.preview.addEventListener("change", event => {
  if (event.target.name === "archive-visible") {
    board.archive.visible = event.target.value === "show"; persistBoard(); showToast("Archive setting saved."); return;
  }
  const itemElement = event.target.closest("[data-archive-id]");
  if (itemElement && event.target.name.startsWith("visibility-")) {
    const block = board.archive.items.find(item => item.id === itemElement.dataset.archiveId);
    if (block) { block.visibility = event.target.value === "private" ? "private" : "public"; persistBoard(); showToast("Post-It visibility saved."); }
  }
});

els.reset.addEventListener("click", () => {
  if (!confirm("Reset the entire board? This will delete all profile text and Post-Its.")) return;
  mediaAdapter.releaseAll(); board = defaultBoard();
  els.profile.reset(); persistBoard(); renderAll(); showToast("Board reset.");
});

function normalizeCloudBoard(value) {
  const clean = defaultBoard();
  if (!value || typeof value !== "object") return clean;
  clean.themeId = typeof value.themeId === "string" ? value.themeId : clean.themeId;
  for (const key of Object.keys(clean.profile)) clean.profile[key] = String(value.profile?.[key] || "");
  clean.blocks = Array.isArray(value.blocks) ? value.blocks.filter(item => item?.id && blockTypes[item.type]).map(sanitizeBlock) : [];
  clean.archive.visible = value.archive?.visible !== false;
  clean.archive.items = Array.isArray(value.archive?.items) ? value.archive.items.filter(item => item?.id && blockTypes[item.type]).map(item => ({ ...sanitizeBlock(item), archived: true, visibility: item.visibility === "private" ? "private" : "public" })) : [];
  return clean;
}

async function hydrateSavedMedia() {
  mediaAdapter.releaseAll();
  const all = [...board.blocks, ...board.archive.items];
  await Promise.all(all.map(async block => {
    if (!block.media?.storagePath) return;
    try { mediaAdapter.setRemote(block.id, { url: await cloud.mediaUrl(block.media.storagePath), kind: block.media.kind }); }
    catch (error) { console.warn("Could not load saved media", error); }
  }));
}

function syncBoardFields() {
  for (const [key, value] of Object.entries(board.profile)) els.profile.elements[key].value = value;
  document.querySelector("#current-board-name").value = currentBoardMeta.boardName;
  document.querySelector("#board-status").value = currentBoardMeta.status;
  document.querySelector("#board-privacy").value = currentBoardMeta.isPublic ? "public" : "private";
}

async function selectBoard(id) {
  if (id === currentBoardId) { els.boardsDialog.close(); return; }
  if (!(await flushSave())) return;
  setSaveState("Loading...");
  try {
    const row = await cloud.getBoard(id);
    currentBoardId = row.id;
    currentBoardMeta = { boardName: row.board_name, status: row.status, isPublic: row.is_public };
    board = normalizeCloudBoard(row.board_data);
    await hydrateSavedMedia(); syncBoardFields(); renderAll(); setSaveState("Saved"); els.boardsDialog.close();
  } catch (error) { setSaveState("Error loading board", true); showToast(error.message); }
}

async function refreshBoardList() {
  boardRows = await cloud.listBoards();
  els.boardsList.innerHTML = boardRows.length ? boardRows.map(row => `<article class="board-row ${row.id === currentBoardId ? "is-current" : ""}"><div><strong>${escapeHtml(row.board_name)}</strong><span>${row.status} · ${row.is_public ? "public" : "private"}</span></div><div><button type="button" data-open-board="${row.id}" ${row.id === currentBoardId ? "disabled" : ""}>${row.id === currentBoardId ? "Open now" : "Open"}</button><button type="button" data-delete-board="${row.id}" aria-label="Delete board ${escapeHtml(row.board_name)}">Delete</button></div></article>`).join("") : `<p class="boards-empty">No boards yet. Create your first one above.</p>`;
}

async function createNewBoard(name, source = defaultBoard()) {
  const row = await cloud.createBoard(currentUser.id, name, source);
  await refreshBoardList(); await selectBoard(row.id); return row;
}

async function showSignedIn(session) {
  currentUser = session.user;
  els.authScreen.hidden = true; els.appShell.hidden = false;
  await refreshBoardList();
  if (!boardRows.length) await createNewBoard("My First Board");
  else await selectBoard(boardRows[0].id);
  try {
    const profile = await cloud.profile();
    if (localStorage.getItem(STORAGE_KEY) && !profile.local_import_decided_at) els.importDialog.showModal();
  } catch (error) { console.warn(error); }
}

async function enterSession(session) {
  if (currentUser) return;
  if (authTransition) return authTransition;
  authTransition = showSignedIn(session).finally(() => { authTransition = null; });
  return authTransition;
}

function showSignedOut() {
  currentUser = null; currentBoardId = null; boardRows = []; mediaAdapter.releaseAll();
  els.appShell.hidden = true; els.authScreen.hidden = false; setSaveState("Saved");
}

document.querySelectorAll("[data-auth-tab]").forEach(button => button.addEventListener("click", () => {
  authMode = button.dataset.authTab;
  document.querySelectorAll("[data-auth-tab]").forEach(tab => tab.setAttribute("aria-selected", String(tab === button)));
  document.querySelector("[data-username-field]").hidden = authMode !== "signup";
  document.querySelector("#auth-username").required = authMode === "signup";
  document.querySelector("#auth-password").autocomplete = authMode === "signup" ? "new-password" : "current-password";
  document.querySelector("#auth-submit").textContent = authMode === "signup" ? "Create account" : "Sign in";
}));

els.authForm.addEventListener("submit", async event => {
  event.preventDefault(); els.authMessage.textContent = authMode === "signup" ? "Creating your account…" : "Signing in…";
  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;
  const username = document.querySelector("#auth-username").value.trim();
  try {
    const { data, error } = authMode === "signup" ? await cloud.signUp(username, email, password) : await cloud.signIn(email, password);
    if (error) throw error;
    els.authMessage.textContent = authMode === "signup" && !data.session ? "Check your email to confirm your account, then sign in." : "Welcome back.";
  } catch (error) { els.authMessage.textContent = error.message; }
});

document.querySelector("#forgot-password").addEventListener("click", async () => {
  const email = document.querySelector("#auth-email").value.trim();
  if (!email) { els.authMessage.textContent = "Enter your email first."; return; }
  const { error } = await cloud.resetPassword(email); els.authMessage.textContent = error ? error.message : "Check your email for a password-reset link.";
});

document.querySelector("#sign-out").addEventListener("click", async () => { if (!(await flushSave())) return; await cloud.signOut(); });
document.querySelector("#boards-button").addEventListener("click", async () => { await refreshBoardList(); els.boardsDialog.showModal(); });
document.querySelector("[data-close-boards]").addEventListener("click", () => els.boardsDialog.close());

document.querySelector("#new-board-form").addEventListener("submit", async event => {
  event.preventDefault(); if (!(await flushSave())) return;
  const input = document.querySelector("#new-board-name");
  try { await createNewBoard(input.value.trim()); input.value = ""; } catch (error) { showToast(error.message); }
});

els.boardsList.addEventListener("click", async event => {
  const open = event.target.closest("[data-open-board]");
  if (open) await selectBoard(open.dataset.openBoard);
  const remove = event.target.closest("[data-delete-board]");
  if (!remove) return;
  const row = boardRows.find(item => item.id === remove.dataset.deleteBoard);
  if (!row || !confirm(`Permanently delete the board “${row.board_name}” and its saved data?`)) return;
  try {
    await cloud.deleteBoard(row.id, currentUser.id);
    if (row.id === currentBoardId) { currentBoardId = null; await refreshBoardList(); if (boardRows.length) await selectBoard(boardRows[0].id); else await createNewBoard("My First Board"); }
    else await refreshBoardList();
  } catch (error) { showToast(error.message); }
});

document.querySelectorAll("#current-board-name, #board-status, #board-privacy").forEach(control => control.addEventListener("change", event => {
  if (event.target.id === "current-board-name") currentBoardMeta.boardName = event.target.value.trim() || "Untitled Board";
  if (event.target.id === "board-status") currentBoardMeta.status = event.target.value;
  if (event.target.id === "board-privacy") currentBoardMeta.isPublic = event.target.value === "public";
  persistBoard();
}));

els.saveStatus.addEventListener("click", () => { if (boardDirty) flushSave(); });

document.querySelector("[data-import-local]").addEventListener("click", async () => {
  const message = document.querySelector("#import-message"); message.textContent = "Importing…";
  try { const imported = storageAdapter.load(); await createNewBoard("Imported Local Board", imported); await cloud.markImportDecision(currentUser.id); els.importDialog.close(); showToast("Local board imported. Your local copy remains untouched."); }
  catch (error) { message.textContent = error.message; }
});
document.querySelector("[data-skip-import]").addEventListener("click", async () => { await cloud.markImportDecision(currentUser.id); els.importDialog.close(); });

window.addEventListener("beforeunload", event => {
  mediaAdapter.releaseAll();
  if (boardDirty || savePromise) { flushSave(); event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("pagehide", () => { if (boardDirty) flushSave(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && boardDirty) flushSave(); });

async function startApplication() {
  if (!configured()) {
    document.querySelector("#setup-message").hidden = false;
    document.querySelector("#auth-tabs").hidden = true; els.authForm.hidden = true;
    return;
  }
  try {
    await initCloud();
    cloud.onAuthChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        const password = prompt("Enter your new password (at least 8 characters):");
        if (password) { const { error } = await cloud.updatePassword(password); els.authMessage.textContent = error ? error.message : "Password updated. You can continue."; }
      }
      if (session && !currentUser) await enterSession(session);
      if (!session && currentUser) showSignedOut();
    });
    const session = await cloud.session(); if (session) await enterSession(session); else showSignedOut();
  } catch (error) { document.querySelector("#setup-message").hidden = false; document.querySelector("#setup-message p").textContent = `Could not connect to Supabase: ${error.message}`; }
}

startApplication();

const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const BUCKET = "board-media";

let client = null;

export function configured() {
  const c = window.WHIMSY_CONFIG || {};
  return /^https:\/\/.+\.supabase\.co$/.test(c.SUPABASE_URL || "") && Boolean(c.SUPABASE_PUBLISHABLE_KEY);
}

export async function initCloud() {
  if (!configured()) return null;
  const { createClient } = await import(SDK_URL);
  const c = window.WHIMSY_CONFIG;
  client = createClient(c.SUPABASE_URL, c.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return client;
}

export const cloud = {
  get client() { return client; },
  async session() { return (await client.auth.getSession()).data.session; },
  onAuthChange(callback) { return client.auth.onAuthStateChange(callback); },
  signUp(username, email, password) { return client.auth.signUp({ email, password, options: { data: { username } } }); },
  signIn(email, password) { return client.auth.signInWithPassword({ email, password }); },
  signOut() { return client.auth.signOut(); },
  resetPassword(email) { return client.auth.resetPasswordForEmail(email, { redirectTo: window.WHIMSY_CONFIG.APP_URL }); },
  updatePassword(password) { return client.auth.updateUser({ password }); },
  async profile() { const { data, error } = await client.from("profiles").select("*").single(); if (error) throw error; return data; },
  async markImportDecision(userId) { const { error } = await client.from("profiles").update({ local_import_decided_at: new Date().toISOString() }).eq("id", userId); if (error) throw error; },
  async listBoards() { const { data, error } = await client.from("boards").select("id,board_name,theme_id,is_public,status,updated_at").order("updated_at", { ascending: false }); if (error) throw error; return data; },
  async getBoard(id) { const { data, error } = await client.from("boards").select("*").eq("id", id).single(); if (error) throw error; return data; },
  async createBoard(userId, boardName, boardData) { const { data, error } = await client.from("boards").insert({ user_id: userId, board_name: boardName, theme_id: boardData.themeId, board_data: boardData }).select().single(); if (error) throw error; return data; },
  async saveBoard(id, values) { const { data, error } = await client.from("boards").update(values).eq("id", id).select("updated_at").single(); if (error) throw error; return data; },
  async deleteBoard(id, userId) {
    const prefix = `${userId}/${id}`;
    const { data: blockFolders, error: listError } = await client.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (listError) throw listError;
    const paths = [];
    for (const folder of blockFolders || []) {
      const { data: files, error } = await client.storage.from(BUCKET).list(`${prefix}/${folder.name}`, { limit: 1000 });
      if (error) throw error;
      for (const file of files || []) if (file.id) paths.push(`${prefix}/${folder.name}/${file.name}`);
    }
    if (paths.length) { const { error } = await client.storage.from(BUCKET).remove(paths); if (error) throw error; }
    const { error } = await client.from("boards").delete().eq("id", id); if (error) throw error;
  },
  async uploadMedia(userId, boardId, blockId, file) {
    const ext = (file.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const path = `${userId}/${boardId}/${blockId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  },
  async removeMedia(path) { if (!path) return; const { error } = await client.storage.from(BUCKET).remove([path]); if (error) throw error; },
  async mediaUrl(path) { const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600); if (error) throw error; return data.signedUrl; }
};

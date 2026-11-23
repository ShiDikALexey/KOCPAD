//! Local note history: signed snapshots of notes in the app profile.
//!
//! Unlike the crash journal (which only keeps dirty text until the next save),
//! history keeps older saved revisions so a note can be rolled back. Files are
//! plain JSON under `history/<hash of path>/<timestamp>.json`, pruned to the
//! newest 50 entries and 30 days.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const KEEP_ENTRIES: usize = 50;
const KEEP_DAYS: u64 = 30;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistorySnapshot {
    pub id: String,
    pub path: String,
    pub saved_at: u64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub saved_at: u64,
    pub size: usize,
}

fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Не удалось найти профиль приложения: {error}"))?;
    let dir = base.join("history");
    fs::create_dir_all(&dir).map_err(|error| format!("Не удалось создать историю: {error}"))?;
    Ok(dir)
}

/// FNV-1a over the note path; keeps directory names filesystem-safe.
fn key_for(path: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in path.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn snapshot_dir(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Пустой путь заметки".into());
    }
    let dir = history_root(app)?.join(key_for(path));
    fs::create_dir_all(&dir).map_err(|error| format!("Не удалось создать историю: {error}"))?;
    Ok(dir)
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 20
        && id.chars().all(|symbol| symbol.is_ascii_digit())
}

fn read_snapshot(file: &Path) -> Option<HistorySnapshot> {
    let text = fs::read_to_string(file).ok()?;
    serde_json::from_str::<HistorySnapshot>(&text).ok()
}

/// Removes old entries: newest 50 and nothing older than 30 days.
fn prune(dir: &Path) {
    let Ok(files) = fs::read_dir(dir) else { return };
    let now = now_ms();
    let cutoff = KEEP_DAYS.saturating_mul(24 * 60 * 60 * 1000);
    let mut entries: Vec<(u64, PathBuf)> = files
        .flatten()
        .filter_map(|file| {
            let path = file.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                return None;
            }
            let snapshot = read_snapshot(&path)?;
            Some((snapshot.saved_at, path))
        })
        .collect();
    entries.sort_by(|left, right| right.0.cmp(&left.0));
    for (index, (saved_at, path)) in entries.into_iter().enumerate() {
        let too_old = saved_at > 0 && now.saturating_sub(saved_at) > cutoff;
        if index >= KEEP_ENTRIES || too_old {
            let _ = fs::remove_file(path);
        }
    }
}

/// Stores one snapshot. The frontend decides when a snapshot is worth writing.
#[tauri::command]
pub fn history_put(app: AppHandle, path: String, text: String) -> Result<HistoryEntry, String> {
    let dir = snapshot_dir(&app, &path)?;
    let mut saved_at = now_ms();
    let mut id = saved_at.to_string();
    while dir.join(format!("{id}.json")).exists() {
        saved_at += 1;
        id = saved_at.to_string();
    }
    let snapshot = HistorySnapshot {
        id: id.clone(),
        path,
        saved_at,
        text: text.clone(),
    };
    let data = serde_json::to_vec(&snapshot)
        .map_err(|error| format!("Не удалось сериализовать версию: {error}"))?;
    let target = dir.join(format!("{id}.json"));
    let temp = dir.join(format!(".{id}.tmp"));
    fs::write(&temp, &data).map_err(|error| format!("Не удалось записать версию: {error}"))?;
    fs::rename(&temp, &target).map_err(|error| format!("Не удалось сохранить версию: {error}"))?;
    prune(&dir);
    Ok(HistoryEntry {
        id,
        saved_at,
        size: text.len(),
    })
}

#[tauri::command]
pub fn history_list(app: AppHandle, path: String) -> Result<Vec<HistoryEntry>, String> {
    let dir = snapshot_dir(&app, &path)?;
    let files = fs::read_dir(&dir).map_err(|error| format!("Не удалось прочитать историю: {error}"))?;
    let mut entries = Vec::new();
    for file in files.flatten() {
        let path = file.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        if let Some(snapshot) = read_snapshot(&path) {
            entries.push(HistoryEntry {
                id: snapshot.id,
                saved_at: snapshot.saved_at,
                size: snapshot.text.len(),
            });
        }
    }
    entries.sort_by(|left, right| right.saved_at.cmp(&left.saved_at));
    Ok(entries)
}

#[tauri::command]
pub fn history_read(app: AppHandle, path: String, id: String) -> Result<String, String> {
    if !safe_id(&id) {
        return Err("Некорректная версия".into());
    }
    let file = snapshot_dir(&app, &path)?.join(format!("{id}.json"));
    let snapshot = read_snapshot(&file).ok_or("Версия не найдена")?;
    Ok(snapshot.text)
}

#[tauri::command]
pub fn history_clear(app: AppHandle, path: String) -> Result<(), String> {
    let dir = history_root(&app)?.join(key_for(&path));
    match fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Не удалось очистить историю: {error}")),
    }
}

//! Crash-recovery journal: keeps the newest text of dirty documents in the app
//! profile, so a kill or a power cut cannot lose the last keystrokes.
//!
//! Entries are tiny JSON files written atomically (temp + rename). The frontend
//! decides when to write them; Rust only owns the storage.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub key: String,
    pub path: String,
    pub text: String,
    pub saved_at: u64,
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Не удалось найти профиль приложения: {error}"))?;
    let dir = base.join("recovery");
    fs::create_dir_all(&dir).map_err(|error| format!("Не удалось создать папку журнала: {error}"))?;
    Ok(dir)
}

fn safe_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|symbol| symbol.is_ascii_alphanumeric() || symbol == '-' || symbol == '_')
}

/// Writes one snapshot. The caller hashes the document path into `key`.
#[tauri::command]
pub fn recovery_write(
    app: AppHandle,
    key: String,
    path: String,
    text: String,
    saved_at: u64,
) -> Result<(), String> {
    if !safe_key(&key) {
        return Err("Некорректный ключ журнала".into());
    }
    let dir = recovery_dir(&app)?;
    let target = dir.join(format!("{key}.json"));
    let temp = dir.join(format!(".{key}.tmp"));
    let entry = RecoveryEntry {
        key: key.clone(),
        path,
        text,
        saved_at,
    };
    let data = serde_json::to_vec(&entry)
        .map_err(|error| format!("Не удалось сериализовать журнал: {error}"))?;
    fs::write(&temp, data).map_err(|error| format!("Не удалось записать журнал: {error}"))?;
    fs::rename(&temp, &target).map_err(|error| format!("Не удалось сохранить журнал: {error}"))
}

/// Lists readable entries, skipping corrupt files instead of failing the start.
#[tauri::command]
pub fn recovery_list(app: AppHandle) -> Result<Vec<RecoveryEntry>, String> {
    let dir = recovery_dir(&app)?;
    let mut entries = Vec::new();
    let files = fs::read_dir(&dir).map_err(|error| format!("Не удалось прочитать журнал: {error}"))?;
    for file in files.flatten() {
        let path = file.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(entry) = serde_json::from_str::<RecoveryEntry>(&text) {
            if !entry.text.is_empty() {
                entries.push(entry);
            }
        }
    }
    entries.sort_by(|left, right| right.saved_at.cmp(&left.saved_at));
    Ok(entries)
}

#[tauri::command]
pub fn recovery_remove(app: AppHandle, key: String) -> Result<(), String> {
    if !safe_key(&key) {
        return Err("Некорректный ключ журнала".into());
    }
    let dir = recovery_dir(&app)?;
    let target = dir.join(format!("{key}.json"));
    match fs::remove_file(target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Не удалось удалить журнал: {error}")),
    }
}

#[tauri::command]
pub fn recovery_clear(app: AppHandle) -> Result<(), String> {
    let dir = recovery_dir(&app)?;
    for file in fs::read_dir(&dir).map_err(|error| format!("{error}"))?.flatten() {
        let path = file.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("json")
            || path.extension().and_then(|ext| ext.to_str()) == Some("tmp")
        {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

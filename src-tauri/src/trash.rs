//! Internal KOCPAD trash.
//!
//! Deletions move the file into the app profile instead of dropping it: a
//! misclick should be recoverable. Entries older than the retention window are
//! purged on startup; the frontend shows the list and restores on demand.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub original_path: String,
    pub name: String,
    pub deleted_at: u64,
    pub is_dir: bool,
    pub size: u64,
}

fn trash_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Не удалось найти профиль приложения: {error}"))?;
    let dir = base.join("trash");
    fs::create_dir_all(&dir).map_err(|error| format!("Не удалось создать корзину: {error}"))?;
    Ok(dir)
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|symbol| symbol.is_ascii_alphanumeric() || symbol == '-' || symbol == '_')
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn read_meta(dir: &Path) -> Option<TrashEntry> {
    let text = fs::read_to_string(dir.join("meta.json")).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_meta(dir: &Path, entry: &TrashEntry) -> Result<(), String> {
    let data =
        serde_json::to_vec(entry).map_err(|error| format!("Не удалось сохранить корзину: {error}"))?;
    // Atomic meta: a torn meta.json used to turn a recoverable deletion into a
    // permanent one. Write a sibling temp file, fsync it, then rename.
    let temp = dir.join("meta.json.tmp");
    let mut file = fs::File::create(&temp)
        .map_err(|error| format!("Не удалось сохранить корзину: {error}"))?;
    file.write_all(&data)
        .map_err(|error| format!("Не удалось сохранить корзину: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Не удалось сохранить корзину: {error}"))?;
    drop(file);
    fs::rename(&temp, dir.join("meta.json"))
        .map_err(|error| format!("Не удалось сохранить корзину: {error}"))
}

/// Moves the payload into place. Cross-volume copies go through a temp name so a
/// partial copy is never visible as a valid trash entry.
fn move_payload(source: &Path, payload: &Path, is_dir: bool) -> Result<(), String> {
    if fs::rename(source, payload).is_ok() {
        return Ok(());
    }
    let temp = payload.with_file_name("payload.tmp");
    let _ = fs::remove_file(&temp);
    let _ = fs::remove_dir_all(&temp);
    if is_dir {
        copy_dir_all(source, &temp)?;
        fs::rename(&temp, payload).map_err(|error| format!("{error}"))?;
        fs::remove_dir_all(source).map_err(|error| format!("Не удалось удалить файл: {error}"))?;
    } else {
        fs::copy(source, &temp).map_err(|error| format!("{error}"))?;
        fs::rename(&temp, payload).map_err(|error| format!("{error}"))?;
        fs::remove_file(source).map_err(|error| format!("Не удалось удалить файл: {error}"))?;
    }
    Ok(())
}

fn copy_dir_all(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| format!("{error}"))?;
    for item in fs::read_dir(from).map_err(|error| format!("{error}"))?.flatten() {
        let target = to.join(item.file_name());
        if item.path().is_dir() {
            copy_dir_all(&item.path(), &target)?;
        } else {
            fs::copy(item.path(), &target).map_err(|error| format!("{error}"))?;
        }
    }
    Ok(())
}

/// Moves a file or folder into the trash; returns the stored entry.
#[tauri::command]
pub async fn trash_put(app: AppHandle, path: String) -> Result<TrashEntry, String> {
    let source = PathBuf::from(&path);
    let metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("Не удалось удалить «{path}»: {error}"))?;
    let is_dir = metadata.is_dir();
    let size = if is_dir { 0 } else { metadata.len() };
    let name = source
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note".into());

    let root = trash_dir(&app)?;
    let deleted_at = now_ms();
    let mut id = format!("{deleted_at}");
    for attempt in 1..1000 {
        if !root.join(&id).exists() {
            break;
        }
        id = format!("{deleted_at}-{attempt}");
    }
    let dir = root.join(&id);
    fs::create_dir_all(&dir).map_err(|error| format!("Не удалось создать запись корзины: {error}"))?;
    let payload = dir.join("payload");

    let entry = TrashEntry {
        id: id.clone(),
        original_path: path,
        name,
        deleted_at,
        is_dir,
        size,
    };
    // Metadata goes first: if the process dies during the move, the payload may
    // be absent but the source still exists; the entry is hidden, never purged.
    write_meta(&dir, &entry)?;
    if let Err(error) = move_payload(&source, &payload, is_dir) {
        if !payload.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        return Err(error);
    }
    Ok(entry)
}

#[tauri::command]
pub async fn trash_list(app: AppHandle) -> Result<Vec<TrashEntry>, String> {
    let root = trash_dir(&app)?;
    let mut entries = Vec::new();
    for item in fs::read_dir(&root).map_err(|error| format!("{error}"))?.flatten() {
        if !item.path().is_dir() {
            continue;
        }
        if let Some(entry) = read_meta(&item.path()) {
            if item.path().join("payload").exists() {
                entries.push(entry);
            }
        }
    }
    entries.sort_by(|left, right| right.deleted_at.cmp(&left.deleted_at));
    Ok(entries)
}

fn unique_target(target: &Path) -> PathBuf {
    let dir = target.parent().unwrap_or_else(|| Path::new(""));
    let stem = target
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note".into());
    let ext = target
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..1000 {
        let candidate = dir.join(if index == 1 {
            format!("{stem} (восстановлено){ext}")
        } else {
            format!("{stem} (восстановлено {index}){ext}")
        });
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem} (восстановлено {}){ext}", now_ms()))
}

/// Restores an entry; returns the path it landed on.
#[tauri::command]
pub async fn trash_restore(app: AppHandle, id: String) -> Result<String, String> {
    if !safe_id(&id) {
        return Err("Некорректный идентификатор записи".into());
    }
    let dir = trash_dir(&app)?.join(&id);
    let entry = read_meta(&dir).ok_or_else(|| "Запись корзины не найдена".to_string())?;
    let payload = dir.join("payload");
    if !payload.exists() {
        return Err("Содержимое записи корзины потеряно".into());
    }
    let target = PathBuf::from(&entry.original_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("{error}"))?;
    }
    let final_target = if target.exists() { unique_target(&target) } else { target };
    if fs::rename(&payload, &final_target).is_err() {
        if entry.is_dir {
            copy_dir_all(&payload, &final_target)?;
            fs::remove_dir_all(&payload).map_err(|error| format!("{error}"))?;
        } else {
            fs::copy(&payload, &final_target).map_err(|error| format!("{error}"))?;
            fs::remove_file(&payload).map_err(|error| format!("{error}"))?;
        }
    }
    let _ = fs::remove_dir_all(&dir);
    Ok(final_target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn trash_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !safe_id(&id) {
        return Err("Некорректный идентификатор записи".into());
    }
    let dir = trash_dir(&app)?.join(&id);
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Не удалось удалить запись: {error}")),
    }
}

/// Removes entries older than `days` and caps the trash at 200 items.
#[tauri::command]
pub async fn trash_purge(app: AppHandle, days: u64) -> Result<u64, String> {
    let root = trash_dir(&app)?;
    // Never allow days=0 to wipe the whole trash; keep at least one day.
    let days = days.max(1);
    let cutoff = now_ms().saturating_sub(days.saturating_mul(24 * 60 * 60 * 1000));
    let mut kept: Vec<(u64, PathBuf)> = Vec::new();
    let mut removed = 0u64;
    for item in fs::read_dir(&root).map_err(|error| format!("{error}"))?.flatten() {
        let dir = item.path();
        if !dir.is_dir() {
            continue;
        }
        match read_meta(&dir) {
            Some(entry) if entry.deleted_at < cutoff => {
                let _ = fs::remove_dir_all(&dir);
                removed += 1;
            }
            Some(entry) => kept.push((entry.deleted_at, dir)),
            // No meta: could be an interrupted delete. Keep it rather than
            // deleting the only payload; it is hidden from the panel.
            None => {}
        }
    }
    kept.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, dir) in kept.into_iter().skip(200) {
        let _ = fs::remove_dir_all(&dir);
        removed += 1;
    }
    Ok(removed)
}

#[tauri::command]
pub async fn trash_empty(app: AppHandle) -> Result<(), String> {
    let root = trash_dir(&app)?;
    for item in fs::read_dir(&root).map_err(|error| format!("{error}"))?.flatten() {
        if item.path().is_dir() {
            let _ = fs::remove_dir_all(item.path());
        }
    }
    Ok(())
}

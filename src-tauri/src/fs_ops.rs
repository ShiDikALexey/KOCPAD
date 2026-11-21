//! File operations behind the native Windows build.
//!
//! Every path is scoped to the workspace root: the frontend can only list, read,
//! write, rename and delete inside the folder the user picked. Custom Tauri
//! commands are not covered by the capability ACL, so the boundary is enforced
//! here instead of trusting the webview.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Workspace root shared by all file commands. `None` until a folder is mounted.
#[derive(Default)]
pub struct WorkspaceRoot(pub Mutex<Option<PathBuf>>);

/// Extensions KOCPAD opens. Anything else is left out of the tree.
const TEXT_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "txt"];

/// Folders that belong to other tools and would only add noise.
const SKIP_DIRS: [&str; 8] = [
    ".git",
    ".obsidian",
    ".trash",
    "node_modules",
    "target",
    "dist",
    ".vscode",
    ".idea",
];

/// Unique sibling temp file: two notes with the same stem (`a.md`, `a.txt`)
/// must not fight over one temp path during a parallel `saveAll`.
fn temp_path(target: &Path) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note".into());
    target.with_file_name(format!(".{name}.{nanos}.kocpad-tmp"))
}

/// Writes bytes to a temp sibling, flushes them to disk, then swaps the file in.
fn write_atomic(temp: &Path, target: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(temp)
        .map_err(|error| format!("Не удалось записать «{}»: {error}", target.display()))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| {
            let _ = fs::remove_file(temp);
            format!("Не удалось записать «{}»: {error}", target.display())
        })?;
    drop(file);
    fs::rename(temp, target).map_err(|error| {
        let _ = fs::remove_file(temp);
        format!("Не удалось сохранить «{}»: {error}", target.display())
    })
}

/// Canonical path of a possibly not-yet-existing file: the deepest existing
/// ancestor is canonicalised and the missing tail is appended.
fn canonical_for_check(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canonical) = fs::canonicalize(path) {
        return Ok(canonical);
    }
    let mut prefix = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !prefix.exists() {
        let Some(name) = prefix.file_name().map(|value| value.to_os_string()) else {
            break;
        };
        if !prefix.pop() {
            break;
        }
        tail.push(name);
    }
    let base = fs::canonicalize(&prefix)
        .map_err(|error| format!("Путь недоступен «{}»: {error}", path.display()))?;
    let mut resolved = base;
    for name in tail.into_iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}

/// Rejects paths outside the mounted workspace, symlinks and the root itself.
fn scoped(state: &State<'_, WorkspaceRoot>, raw: &str, allow_root: bool) -> Result<PathBuf, String> {
    let root = state
        .0
        .lock()
        .map_err(|_| "Состояние рабочей папки повреждено".to_string())?
        .clone()
        .ok_or_else(|| "Рабочая папка не подключена".to_string())?;
    let candidate = PathBuf::from(raw);
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Путь не может выходить за рабочую папку".into());
    }
    let canonical = canonical_for_check(&candidate)?;
    if canonical == root {
        if allow_root {
            return Ok(candidate);
        }
        return Err("Нельзя изменить корень рабочей папки".into());
    }
    if !canonical.starts_with(&root) {
        return Err("Путь вне рабочей папки".into());
    }
    if let Ok(metadata) = fs::symlink_metadata(&candidate) {
        if metadata.file_type().is_symlink() {
            return Err("Симлинки не поддерживаются".into());
        }
    }
    Ok(candidate)
}

/// Points the file commands at a workspace. `None` detaches (folder closed).
#[tauri::command]
pub async fn fs_set_root(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
) -> Result<(), String> {
    let canonical = match root {
        Some(path) => Some(
            fs::canonicalize(&path)
                .map_err(|error| format!("Папка недоступна «{path}»: {error}"))?,
        ),
        None => None,
    };
    *state
        .0
        .lock()
        .map_err(|_| "Состояние рабочей папки повреждено".to_string())? = canonical;
    Ok(())
}

#[derive(Serialize)]
pub struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    children: Vec<FileNode>,
}

fn is_text_file(path: &Path) -> bool {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) => {
            let lower = extension.to_ascii_lowercase();
            TEXT_EXTENSIONS.contains(&lower.as_str())
        }
        None => false,
    }
}

fn list_dir(dir: &Path) -> Vec<FileNode> {
    let mut dirs: Vec<FileNode> = Vec::new();
    let mut files: Vec<FileNode> = Vec::new();

    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            dirs.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                size: 0,
                children: list_dir(&path),
            });
        } else if is_text_file(&path) {
            files.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                size: metadata.len(),
                children: Vec::new(),
            });
        }
    }

    let by_name = |a: &FileNode, b: &FileNode| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.extend(files);
    dirs
}

/// Returns the workspace tree below `path`. Empty folders are kept on purpose:
/// the user may have just created one.
#[tauri::command]
pub async fn fs_list_tree(
    state: State<'_, WorkspaceRoot>,
    path: String,
) -> Result<Vec<FileNode>, String> {
    let root = scoped(&state, &path, true)?;
    if !root.is_dir() {
        return Err(format!("Не папка: {path}"));
    }
    Ok(list_dir(&root))
}

#[tauri::command]
pub async fn fs_read_text(state: State<'_, WorkspaceRoot>, path: String) -> Result<String, String> {
    let target = scoped(&state, &path, false)?;
    fs::read_to_string(&target).map_err(|error| format!("Не удалось прочитать «{path}»: {error}"))
}

#[tauri::command]
pub async fn fs_write_text(
    state: State<'_, WorkspaceRoot>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let target = scoped(&state, &path, false)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать папку: {error}"))?;
    }
    let temp = temp_path(&target);
    write_atomic(&temp, &target, contents.as_bytes())
}

/// Export/«Save as»: the path comes from the native save dialog, not from a note,
/// so it is deliberately outside the workspace scope.
#[tauri::command]
pub async fn fs_save_text(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать папку: {error}"))?;
    }
    let temp = temp_path(&target);
    write_atomic(&temp, &target, contents.as_bytes())
}

#[tauri::command]
pub async fn fs_create_dir(state: State<'_, WorkspaceRoot>, path: String) -> Result<(), String> {
    let target = scoped(&state, &path, false)?;
    fs::create_dir_all(&target).map_err(|error| format!("Не удалось создать папку: {error}"))
}

/// Reads a pasted image. Base64 keeps the IPC payload compact and valid UTF-8.
#[tauri::command]
pub async fn fs_read_binary(
    state: State<'_, WorkspaceRoot>,
    path: String,
) -> Result<String, String> {
    let target = scoped(&state, &path, false)?;
    const MAX_BINARY: u64 = 25 * 1024 * 1024;
    let metadata = fs::metadata(&target)
        .map_err(|error| format!("Не удалось прочитать «{path}»: {error}"))?;
    if metadata.len() > MAX_BINARY {
        return Err(format!("Файл больше 25 МБ: «{path}»"));
    }
    let bytes = fs::read(&target).map_err(|error| format!("Не удалось прочитать «{path}»: {error}"))?;
    Ok(BASE64.encode(bytes))
}

#[tauri::command]
pub async fn fs_write_binary(
    state: State<'_, WorkspaceRoot>,
    path: String,
    data: String,
) -> Result<(), String> {
    let target = scoped(&state, &path, false)?;
    let bytes = BASE64
        .decode(data.as_bytes())
        .map_err(|error| format!("Некорректные данные файла: {error}"))?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать папку: {error}"))?;
    }
    let temp = temp_path(&target);
    write_atomic(&temp, &target, &bytes)
}

#[tauri::command]
pub async fn fs_rename(
    state: State<'_, WorkspaceRoot>,
    from: String,
    to: String,
) -> Result<(), String> {
    let source = scoped(&state, &from, false)?;
    let target = scoped(&state, &to, false)?;
    fs::rename(&source, &target).map_err(|error| format!("Не удалось переименовать: {error}"))
}

#[tauri::command]
pub async fn fs_remove(state: State<'_, WorkspaceRoot>, path: String) -> Result<(), String> {
    let target = scoped(&state, &path, false)?;
    let result = if target.is_dir() {
        fs::remove_dir_all(&target)
    } else {
        fs::remove_file(&target)
    };
    result.map_err(|error| format!("Не удалось удалить «{path}»: {error}"))
}

#[tauri::command]
pub async fn fs_exists(
    state: State<'_, WorkspaceRoot>,
    path: String,
) -> Result<bool, String> {
    Ok(match scoped(&state, &path, true) {
        Ok(target) => target.exists(),
        Err(_) => false,
    })
}

/// Version stamp of a file: mtime plus size, used to notice edits made by other
/// programs before KOCPAD overwrites them with a full snapshot.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    mtime_ms: u64,
    size: u64,
}

#[tauri::command]
pub async fn fs_stat(
    state: State<'_, WorkspaceRoot>,
    path: String,
) -> Result<Option<FileStat>, String> {
    let target = match scoped(&state, &path, true) {
        Ok(target) => target,
        Err(_) => return Ok(None),
    };
    let metadata = match fs::metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Не удалось прочитать «{path}»: {error}")),
    };
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    Ok(Some(FileStat {
        mtime_ms,
        size: metadata.len(),
    }))
}

/// Opens http(s)/mailto links in the user's browser. Other schemes are refused.
///
/// The shell is never involved: `open` uses `ShellExecuteW`, so characters like
/// `&` or `|` inside a URL cannot turn into a Windows command.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let allowed = url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("mailto:");
    if !allowed {
        return Err("Разрешены только ссылки http, https и mailto".into());
    }
    open::that(&url).map_err(|error| format!("Не удалось открыть ссылку: {error}"))
}

/// Highlights the note in Explorer. Failures are not worth interrupting the user.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|error| format!("{error}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|error| format!("{error}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = path;
    }
    Ok(())
}

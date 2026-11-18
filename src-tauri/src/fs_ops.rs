//! File operations behind the native Windows build.
//!
//! KOCPAD keeps notes as plain files on disk, so the Rust side stays deliberately
//! small: list a workspace tree, read, write, create, rename, delete, and hand
//! links to the default browser. Everything runs outside the webview sandbox, so
//! the JavaScript side only needs one `invoke` per operation.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::Path;

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
pub fn fs_list_tree(path: String) -> Result<Vec<FileNode>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Не папка: {path}"));
    }
    Ok(list_dir(root))
}

#[tauri::command]
pub fn fs_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("Не удалось прочитать «{path}»: {error}"))
}

#[tauri::command]
pub fn fs_write_text(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать папку: {error}"))?;
    }

    // Write beside the target and swap it in, so a crash cannot leave half a file.
    let temp = target.with_extension("kocpad-tmp");
    fs::write(&temp, contents.as_bytes())
        .map_err(|error| format!("Не удалось записать «{path}»: {error}"))?;
    fs::rename(&temp, target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Не удалось сохранить «{path}»: {error}")
    })
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|error| format!("Не удалось создать папку: {error}"))
}

/// Reads a pasted image. Base64 keeps the IPC payload compact and valid UTF-8.
#[tauri::command]
pub fn fs_read_binary(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|error| format!("Не удалось прочитать «{path}»: {error}"))?;
    Ok(BASE64.encode(bytes))
}

#[tauri::command]
pub fn fs_write_binary(path: String, data: String) -> Result<(), String> {
    let bytes = BASE64
        .decode(data.as_bytes())
        .map_err(|error| format!("Некорректные данные файла: {error}"))?;

    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать папку: {error}"))?;
    }

    let temp = target.with_extension("kocpad-tmp");
    fs::write(&temp, &bytes).map_err(|error| format!("Не удалось записать «{path}»: {error}"))?;
    fs::rename(&temp, target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Не удалось сохранить «{path}»: {error}")
    })
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err(format!("Уже существует: {to}"));
    }
    fs::rename(&from, &to).map_err(|error| format!("Не удалось переименовать: {error}"))
}

#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    let result = if target.is_dir() {
        fs::remove_dir_all(target)
    } else {
        fs::remove_file(target)
    };
    result.map_err(|error| format!("Не удалось удалить «{path}»: {error}"))
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Opens http(s)/mailto links in the user's browser. Other schemes are refused.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let allowed = url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("mailto:");
    if !allowed {
        return Err("Разрешены только ссылки http, https и mailto".into());
    }

    #[cfg(target_os = "windows")]
    {
        // The empty argument is the window title `start` expects before the URL.
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|error| format!("Не удалось открыть ссылку: {error}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("Не удалось открыть ссылку: {error}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("Не удалось открыть ссылку: {error}"))?;
    }

    Ok(())
}

/// Highlights the note in Explorer. Failures are not worth interrupting the user.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|error| format!("Не удалось показать файл: {error}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|error| format!("Не удалось показать файл: {error}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = Path::new(&path).parent().unwrap_or(Path::new("."));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| format!("Не удалось показать файл: {error}"))?;
    }

    Ok(())
}

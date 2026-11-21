mod fs_ops;
mod recovery;
mod trash;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Set once the webview is alive and has registered its close handler.
/// Before that the window closes normally instead of being held open.
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn kocpad_ready() {
    FRONTEND_READY.store(true, Ordering::SeqCst);
}

/// Closes the window for real, bypassing the `CloseRequested` interception.
#[tauri::command]
fn kocpad_close_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.destroy();
    }
}

/// Entry point shared by the desktop binary and the mobile targets.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(fs_ops::WorkspaceRoot::default())
        // Must be the first plugin: a second launch focuses the running window
        // instead of opening another copy that would write the same files.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Restores the window size and position from the previous run.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        // Quick capture: Ctrl+Alt+N works even when KOCPAD is in the background.
        // The shortcut itself is registered in `setup` below, so a conflict with
        // another application logs a warning instead of aborting startup.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window
                            .eval("window.__kocpadQuickCapture && window.__kocpadQuickCapture();");
                    }
                })
                .build(),
        )
        .setup(|app| {
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
            if let Err(error) = app.handle().global_shortcut().register(shortcut) {
                // A hotkey owned by another app must not stop KOCPAD from starting.
                eprintln!("quick-capture hotkey unavailable: {error}");
            }
            Ok(())
        })
        // In-app updates: checks the release JSON and installs signed updates.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            fs_ops::fs_list_tree,
            fs_ops::fs_read_text,
            fs_ops::fs_write_text,
            fs_ops::fs_read_binary,
            fs_ops::fs_write_binary,
            fs_ops::fs_create_dir,
            fs_ops::fs_rename,
            fs_ops::fs_remove,
            fs_ops::fs_exists,
            fs_ops::open_external,
            fs_ops::reveal_in_explorer,
            fs_ops::fs_stat,
            fs_ops::fs_set_root,
            fs_ops::fs_save_text,
            recovery::recovery_write,
            recovery::recovery_list,
            recovery::recovery_remove,
            recovery::recovery_clear,
            trash::trash_put,
            trash::trash_list,
            trash::trash_restore,
            trash::trash_delete,
            trash::trash_purge,
            trash::trash_empty,
            kocpad_ready,
            kocpad_close_window,
        ])
        // The frontend decides whether there is anything to ask before quitting
        // (unsaved file changes, notes that are still drafts).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !FRONTEND_READY.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                match window.app_handle().get_webview_window("main") {
                    Some(webview) => {
                        let asked = webview
                            .eval("window.__kocpadRequestClose && window.__kocpadRequestClose();");
                        if asked.is_err() {
                            // The page is gone: do not trap the user in a dead window.
                            let _ = webview.destroy();
                        }
                    }
                    None => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running KOCPAD");
}

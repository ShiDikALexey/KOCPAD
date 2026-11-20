mod fs_ops;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

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
        // Restores the window size and position from the previous run.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        // Quick capture: Ctrl+Alt+N works even when KOCPAD is in the background.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CommandOrControl+Alt+N")
                .expect("valid quick-capture shortcut")
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

mod fs_ops;
mod history;
mod recovery;
mod trash;
mod updates;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// A note passed on the command line (file association / second launch), waiting
/// for the frontend to pick it up after boot.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

const OPEN_FILE_EVENT: &str = "open-file";

fn note_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| {
            let path = Path::new(arg);
            if !path.is_file() {
                return false;
            }
            matches!(
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.to_ascii_lowercase())
                    .as_deref(),
                Some("md" | "markdown" | "mdown" | "txt")
            )
        })
        .cloned()
}

/// Returns the file from the first launch once; the frontend opens it and mounts
/// its folder as the workspace.
#[tauri::command]
fn take_initial_file(pending: State<'_, PendingFile>) -> Option<String> {
    pending
        .0
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
}

fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// System tray: quick access to the window, a fresh note and a proper quit that
/// still goes through the frontend close flow (unsaved text must not be lost).
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "Показать KOCPAD").build(app)?;
    let new_note = MenuItemBuilder::with_id("new-note", "Новая заметка").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Выход").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &new_note, &quit])
        .build()?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("KOCPAD")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "new-note" => {
                show_main(app);
                let _ = app.emit("tray-new-note", ());
            }
            "quit" => {
                let _ = app.emit("tray-quit", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

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

/// Turns off WebView2's browser-specific accelerator keys and its default
/// context menu in release builds.
///
/// By default WebView2 handles Ctrl+P, Ctrl+F, F5, Ctrl+Plus/Minus and the
/// devtools shortcuts itself, before the page sees them. That is why Ctrl+P
/// printed the whole application UI: the host printed the page instead of the
/// note HTML that KOCPAD builds for printing. KOCPAD ships its own print path,
/// find panel, refresh and zoom, and draws its own context menu, so the browser
/// behaviour is both redundant and wrong here.
#[cfg(all(windows, not(debug_assertions)))]
fn harden_webview(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let result = window.with_webview(|webview| unsafe {
        let controller = webview.controller();
        let Ok(core) = controller.CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        let _ = settings.SetAreDefaultContextMenusEnabled(false);
        // ICoreWebView2Settings3 is the interface that owns this flag; older
        // WebView2 runtimes simply do not expose it.
        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
    if let Err(error) = result {
        eprintln!("webview hardening unavailable: {error}");
    }
}

/// Entry point shared by the desktop binary and the mobile targets.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(fs_ops::WorkspaceRoot::default())
        .manage(PendingFile::default())
        // Must be the first plugin: a second launch focuses the running window
        // instead of opening another copy that would write the same files.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // Double-clicking a .md while KOCPAD is running opens it in the
            // existing window.
            if let Some(file) = note_from_args(&args) {
                let _ = app.emit(OPEN_FILE_EVENT, file);
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
            // A file opened from Explorer or via the file association arrives as
            // a command-line argument; keep it for the frontend.
            let args: Vec<String> = std::env::args().collect();
            if let Some(file) = note_from_args(&args) {
                if let Ok(mut slot) = app.state::<PendingFile>().0.lock() {
                    *slot = Some(file);
                }
            }
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
            if let Err(error) = app.handle().global_shortcut().register(shortcut) {
                // A hotkey owned by another app must not stop KOCPAD from starting.
                eprintln!("quick-capture hotkey unavailable: {error}");
            }
            #[cfg(all(windows, not(debug_assertions)))]
            if let Some(window) = app.get_webview_window("main") {
                harden_webview(&window);
            }
            if let Err(error) = build_tray(app) {
                // A tray icon is a convenience: never block startup on it.
                eprintln!("tray icon unavailable: {error}");
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
            updates::update_check,
            updates::update_install,
            history::history_put,
            history::history_list,
            history::history_read,
            history::history_clear,
            kocpad_ready,
            kocpad_close_window,
            take_initial_file,
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

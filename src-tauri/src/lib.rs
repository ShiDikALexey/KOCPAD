mod fs_ops;

/// Entry point shared by the desktop binary and the mobile targets.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_ops::fs_list_tree,
            fs_ops::fs_read_text,
            fs_ops::fs_write_text,
            fs_ops::fs_create_dir,
            fs_ops::fs_rename,
            fs_ops::fs_remove,
            fs_ops::fs_exists,
            fs_ops::open_external,
            fs_ops::reveal_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KOCPAD");
}

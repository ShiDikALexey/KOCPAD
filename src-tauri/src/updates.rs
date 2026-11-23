use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Url};
use tauri_plugin_updater::UpdaterExt;

const STABLE_ENDPOINT: &str =
    "https://github.com/ShiDikALexey/KOCPAD/releases/latest/download/latest.json";
const BETA_ENDPOINT: &str =
    "https://github.com/ShiDikALexey/KOCPAD/releases/download/beta-channel/latest.json";

/// What the frontend needs to render the update badge and the dialog.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
    pub channel: String,
}

fn endpoint(channel: &str) -> Result<Url, String> {
    let raw = if channel == "beta" {
        BETA_ENDPOINT
    } else {
        STABLE_ENDPOINT
    };
    Url::parse(raw).map_err(|error| error.to_string())
}

fn build(app: &AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater_builder()
        .endpoints(vec![endpoint(channel)?])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())
}

/// Checks the channel endpoint. The frontend calls this on startup and manually;
/// the beta endpoint is a rolling release whose `latest.json` CI rewrites.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    channel: String,
) -> Result<Option<UpdateInfo>, String> {
    let updater = build(&app, &channel)?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
        current_version: update.current_version,
        body: update.body,
        channel,
    }))
}

/// Downloads, verifies and installs the update from the selected channel.
/// On Windows the installer replaces the app and exits the process.
#[tauri::command]
pub async fn update_install(app: AppHandle, channel: String) -> Result<(), String> {
    let updater = build(&app, &channel)?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    let Some(update) = update else {
        return Err("Обновление не найдено".into());
    };
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|error| error.to_string())
}

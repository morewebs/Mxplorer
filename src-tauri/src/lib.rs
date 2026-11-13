use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder},
    Emitter, Manager, Webview, WebviewUrl,
};

type Result<T = ()> = std::result::Result<T, String>;
mod cookies;
#[cfg(windows)]
#[path = "cookies_windows.rs"]
mod cookies_native;
#[cfg(not(windows))]
mod cookies_native {
    use super::*;
    pub async fn list(_: &Webview) -> Result<Vec<cookies::CookieRecord>> {
        Err("Requires Windows WebView2".into())
    }
    pub async fn apply(_: &Webview, _: Vec<cookies::CookieRecord>) -> Result {
        Err("Requires Windows WebView2".into())
    }
    pub async fn delete(_: &Webview, _: Vec<cookies::CookieKey>) -> Result {
        Err("Requires Windows WebView2".into())
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn validate(self) -> Result<Self> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
            || self.x + self.width > 32768.0
            || self.y + self.height > 32768.0
        {
            Err("Invalid content bounds".into())
        } else {
            Ok(self)
        }
    }
    fn rect(self) -> tauri::Rect {
        tauri::Rect {
            position: tauri::LogicalPosition::new(self.x, self.y).into(),
            size: tauri::LogicalSize::new(self.width, self.height).into(),
        }
    }
}

#[derive(Default)]
struct Tabs {
    ids: HashSet<String>,
    active: Option<String>,
    bounds: Option<Bounds>,
    overlay: bool,
    overlay_epoch: u64,
    snapshot: Option<String>,
}
#[derive(Default)]
struct BrowserState {
    tabs: Mutex<Tabs>,
    downloads: Mutex<HashMap<PathBuf, Download>>,
}
#[derive(Clone, Serialize)]
struct Download {
    id: String,
    url: String,
    name: String,
    path: String,
    status: String,
}

fn new_download_id() -> String {
    format!("download-{}", uuid::Uuid::new_v4())
}

fn trusted(caller: &Webview) -> Result {
    if caller.label() == "main" && caller.url().map(|url| trusted_url(&url)).unwrap_or(false) {
        Ok(())
    } else {
        Err("Only trusted browser chrome may invoke this command".into())
    }
}
fn trusted_url(url: &tauri::Url) -> bool {
    if cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(1420)
    {
        return true;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
}
fn valid_id(id: &str) -> bool {
    id.starts_with("tab-")
        && id.len() > 4
        && id.len() <= 100
        && id[4..]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
fn remote_url(raw: &str) -> Result<tauri::Url> {
    let url = tauri::Url::parse(raw).map_err(|_| "Invalid URL")?;
    if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() {
        Ok(url)
    } else {
        Err("Only HTTP and HTTPS websites can be opened".into())
    }
}
fn guest(app: &tauri::AppHandle, id: &str) -> Result<Webview> {
    if !valid_id(id) {
        return Err("Invalid tab ID".into());
    }
    app.get_webview(id)
        .ok_or_else(|| "Tab no longer exists".into())
}
fn emit(app: &tauri::AppHandle, event: &str, payload: impl Serialize + Clone) {
    let _ = app.emit_to(tauri::EventTarget::webview("main"), event, payload);
}

/// Serializes visibility changes with tab state, so a late create cannot replace a newer selection.
fn apply_visibility(app: &tauri::AppHandle) -> Result {
    let state = app.state::<BrowserState>();
    let tabs = state.tabs.lock().map_err(|_| "Tab state unavailable")?;
    for id in &tabs.ids {
        if let Some(view) = app.get_webview(id) {
            if !tabs.overlay && tabs.active.as_ref() == Some(id) {
                if let Some(bounds) = tabs.bounds {
                    view.set_bounds(bounds.rect()).map_err(|e| e.to_string())?;
                }
                view.show().map_err(|e| e.to_string())?;
            } else {
                view.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn create_tab(
    caller: Webview,
    app: tauri::AppHandle,
    id: String,
    url: String,
    bounds: Bounds,
) -> Result {
    trusted(&caller)?;
    if !valid_id(&id) {
        return Err("Invalid tab ID".into());
    }
    let url = remote_url(&url)?;
    let bounds = bounds.validate()?;
    {
        let state = app.state::<BrowserState>();
        let mut tabs = state.tabs.lock().map_err(|_| "Tab state unavailable")?;
        if !tabs.ids.insert(id.clone()) {
            return Err("Tab already exists".into());
        }
        tabs.bounds = Some(bounds);
    }
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("GuestProfile");
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let nav_app = app.clone();
    let nav_id = id.clone();
    let title_app = app.clone();
    let title_id = id.clone();
    let load_app = app.clone();
    let load_id = id.clone();
    let popup_app = app.clone();
    let download_app = app.clone();
    let builder = WebviewBuilder::new(&id, WebviewUrl::External("about:blank".parse().unwrap()))
        .data_directory(data)
        .devtools(false)
        .zoom_hotkeys_enabled(false)
        .focused(false)
        .background_color(tauri::webview::Color(20, 20, 20, 255))
        .on_navigation(move |url| {
            let allowed = remote_url(url.as_str()).is_ok() || url.as_str() == "about:blank";
            if allowed {
                emit(
                    &nav_app,
                    "tab-update",
                    json!({"id":nav_id,"url":url.as_str()}),
                );
            }
            allowed
        })
        .on_new_window(move |url, _| {
            if remote_url(url.as_str()).is_ok() {
                emit(&popup_app, "new-tab", json!({"url":url.as_str()}));
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(move |_, title| {
            emit(
                &title_app,
                "tab-update",
                json!({"id":title_id,"title":title}),
            );
        })
        .on_page_load(move |view, payload| {
            let started = payload.event() == PageLoadEvent::Started;
            let mut update = json!({"id":load_id,"url":payload.url().as_str(),"loading":started});
            if started {
                update["error"] = Value::Null;
            }
            emit(&load_app, "tab-update", update);
            native::refresh(&view, &load_app, &load_id);
        })
        .on_download(move |_, event| download_event(&download_app, event));
    let window = app.get_window("main").ok_or("Main window unavailable")?;
    // Construct offscreen so an asynchronous background-tab create never flashes over chrome.
    let created = window.add_child(
        builder,
        tauri::LogicalPosition::new(-32000., -32000.),
        tauri::LogicalSize::new(bounds.width, bounds.height),
    );
    let view = match created {
        Ok(view) => view,
        Err(error) => {
            app.state::<BrowserState>()
                .tabs
                .lock()
                .map_err(|_| "Tab state unavailable")?
                .ids
                .remove(&id);
            return Err(error.to_string());
        }
    };
    view.hide().map_err(|e| e.to_string())?;
    if !app
        .state::<BrowserState>()
        .tabs
        .lock()
        .map_err(|_| "Tab state unavailable")?
        .ids
        .contains(&id)
    {
        let _ = view.close();
        return Ok(());
    }
    native::install(&view, &app, &id)?;
    let _ = cookies::reconcile_profile(&app).await;
    view.navigate(url).map_err(|e| e.to_string())?;
    apply_visibility(&app)
}

#[tauri::command]
fn activate_tab(
    caller: Webview,
    app: tauri::AppHandle,
    id: Option<String>,
    bounds: Bounds,
) -> Result {
    trusted(&caller)?;
    let bounds = bounds.validate()?;
    let overlay = {
        let state = app.state::<BrowserState>();
        let mut tabs = state.tabs.lock().map_err(|_| "Tab state unavailable")?;
        if let Some(id) = &id {
            if !valid_id(id) || !tabs.ids.contains(id) {
                return Err("Unknown tab".into());
            }
        }
        tabs.active = id.clone();
        tabs.bounds = Some(bounds);
        tabs.overlay
    };
    apply_visibility(&app)?;
    if let Some(id) = id.filter(|_| !overlay) {
        if let Some(view) = app.get_webview(&id) {
            let _ = view.set_focus();
        }
    } else if let Some(main) = app.get_webview("main") {
        let _ = main.set_focus();
    }
    Ok(())
}
#[tauri::command]
fn close_tab(caller: Webview, app: tauri::AppHandle, id: String) -> Result {
    trusted(&caller)?;
    if !valid_id(&id) {
        return Err("Invalid tab ID".into());
    }
    {
        let state = app.state::<BrowserState>();
        let mut tabs = state.tabs.lock().map_err(|_| "Tab state unavailable")?;
        tabs.ids.remove(&id);
        if tabs.active.as_ref() == Some(&id) {
            tabs.active = None;
        }
    }
    if let Some(view) = app.get_webview(&id) {
        view.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
async fn navigate_tab(caller: Webview, app: tauri::AppHandle, id: String, url: String) -> Result {
    trusted(&caller)?;
    let _ = cookies::reconcile_profile(&app).await;
    guest(&app, &id)?
        .navigate(remote_url(&url)?)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn tab_action(
    caller: Webview,
    app: tauri::AppHandle,
    id: String,
    action: String,
    value: Option<Value>,
) -> Result {
    trusted(&caller)?;
    let view = guest(&app, &id)?;
    match action.as_str() {
        "reload" if value.as_ref().and_then(Value::as_bool) == Some(true) => {
            native::action(&view, "hard-reload".into(), None)
        }
        "reload" => view.reload().map_err(|e| e.to_string()),
        "print" => view.print().map_err(|e| e.to_string()),
        "focus" => view.set_focus().map_err(|e| e.to_string()),
        "back" | "forward" | "stop" | "zoom" | "find" => native::action(&view, action, value),
        _ => Err("Unknown tab action".into()),
    }
}
#[tauri::command]
fn resize_content(caller: Webview, app: tauri::AppHandle, bounds: Bounds) -> Result {
    trusted(&caller)?;
    app.state::<BrowserState>()
        .tabs
        .lock()
        .map_err(|_| "Tab state unavailable")?
        .bounds = Some(bounds.validate()?);
    apply_visibility(&app)
}

#[tauri::command]
async fn set_overlay(caller: Webview, app: tauri::AppHandle, open: bool) -> Result<Option<String>> {
    trusted(&caller)?;
    let (epoch, active) = {
        let state = app.state::<BrowserState>();
        let mut tabs = state.tabs.lock().map_err(|_| "Tab state unavailable")?;
        if open && tabs.overlay {
            return Ok(tabs.snapshot.clone());
        }
        tabs.overlay = open;
        tabs.overlay_epoch = tabs.overlay_epoch.wrapping_add(1);
        tabs.snapshot = None;
        (tabs.overlay_epoch, tabs.active.clone())
    };
    if !open {
        apply_visibility(&app)?;
        return Ok(None);
    }
    let mut snapshot = if let Some(view) = active.as_ref().and_then(|id| app.get_webview(id)) {
        native::capture_preview(&view).await
    } else {
        None
    };
    {
        let state = app.state::<BrowserState>();
        let mut tabs = state.tabs.lock().map_err(|_| "Tab state unavailable")?;
        // A capture may complete after the dropdown closes or another one opens.
        if !tabs.overlay || tabs.overlay_epoch != epoch {
            return Ok(None);
        }
        if tabs.active != active {
            snapshot = None;
        }
        tabs.snapshot = snapshot.clone();
    }
    apply_visibility(&app)?;
    if let Some(main) = app.get_webview("main") {
        let _ = main.set_focus();
    }
    Ok(snapshot)
}
#[tauri::command]
fn window_action(caller: Webview, app: tauri::AppHandle, action: String) -> Result {
    trusted(&caller)?;
    let window = app.get_window("main").ok_or("Main window unavailable")?;
    let result = match action.as_str() {
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        "fullscreen" => window.set_fullscreen(!window.is_fullscreen().map_err(|e| e.to_string())?),
        "start-drag" => window.start_dragging(),
        _ => return Err("Unknown window action".into()),
    };
    result.map_err(|e| e.to_string())
}
fn downloads_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let path = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?
        .join("Mxplorer");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
#[tauri::command]
fn open_downloads(caller: Webview, app: tauri::AppHandle) -> Result {
    trusted(&caller)?;
    let path = downloads_dir(&app)?;
    std::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn clear_browsing_data(caller: Webview, app: tauri::AppHandle) -> Result {
    trusted(&caller)?;
    cookies::clear_profile(&app).await
}

fn safe_filename(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(120)
        .collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    let stem = cleaned
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if cleaned.is_empty() {
        "download".into()
    } else if reserved {
        format!("_{cleaned}")
    } else {
        cleaned.into()
    }
}
fn unique_destination(dir: &Path, name: &str, reserved: &HashMap<PathBuf, Download>) -> PathBuf {
    let available = |path: &Path| {
        !path.exists()
            && !reserved.keys().any(|key| {
                key.to_string_lossy()
                    .eq_ignore_ascii_case(&path.to_string_lossy())
            })
    };
    let initial = dir.join(name);
    if available(&initial) {
        return initial;
    }
    let file = Path::new(name);
    let stem = file.file_stem().unwrap_or_default().to_string_lossy();
    let extension = file
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for index in 1.. {
        let path = dir.join(format!("{stem} ({index}){extension}"));
        if available(&path) {
            return path;
        }
    }
    unreachable!()
}
fn download_event(app: &tauri::AppHandle, event: DownloadEvent<'_>) -> bool {
    let state = app.state::<BrowserState>();
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Ok(dir) = downloads_dir(app) else {
                return false;
            };
            let name = safe_filename(
                &destination
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy(),
            );
            let Ok(mut downloads) = state.downloads.lock() else {
                return false;
            };
            *destination = unique_destination(&dir, &name, &downloads);
            let download = Download {
                id: new_download_id(),
                url: url.into(),
                name: destination
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                path: destination.to_string_lossy().into(),
                status: "downloading".into(),
            };
            downloads.insert(destination.clone(), download.clone());
            emit(app, "download-update", download);
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            if let Ok(mut downloads) = state.downloads.lock() {
                let key = path.filter(|p| downloads.contains_key(p)).or_else(|| {
                    downloads
                        .iter()
                        .find(|(_, d)| d.url == url.as_str() && d.status == "downloading")
                        .map(|(p, _)| p.clone())
                });
                if let Some(key) = key {
                    if let Some(download) = downloads.get_mut(&key) {
                        download.status = if success { "completed" } else { "failed" }.into();
                        emit(app, "download-update", download.clone());
                    }
                }
            }
            true
        }
        _ => true,
    }
}

#[cfg(windows)]
mod native;
#[cfg(not(windows))]
mod native {
    use super::*;
    pub fn install(_: &Webview, _: &tauri::AppHandle, _: &str) -> Result {
        Ok(())
    }
    pub fn refresh(_: &Webview, _: &tauri::AppHandle, _: &str) {}
    pub fn action(_: &Webview, _: String, _: Option<Value>) -> Result {
        Err("Requires Windows WebView2".into())
    }
    pub async fn clear_data(view: &Webview) -> Result {
        view.clear_all_browsing_data().map_err(|e| e.to_string())
    }
    pub async fn capture_preview(_: &Webview) -> Option<String> {
        None
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(BrowserState::default())
        .manage(cookies::CookieState::default())
        .setup(|app| {
            cookies::initialize(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-boundary")
                .on_navigation(|view, url| {
                    if view.label() == "main" {
                        trusted_url(url)
                    } else {
                        remote_url(url.as_str()).is_ok() || url.as_str() == "about:blank"
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            create_tab,
            activate_tab,
            close_tab,
            navigate_tab,
            tab_action,
            resize_content,
            window_action,
            open_downloads,
            clear_browsing_data,
            set_overlay,
            cookies::get_cookies,
            cookies::save_cookies,
            cookies::delete_cookies,
            cookies::set_saved_cookie,
            cookies::restore_cookies
        ])
        .run(tauri::generate_context!())
        .expect("Mxplorer could not start");
}

#[cfg(all(windows, feature = "native-cookie-smoke"))]
pub fn run_cookie_smoke() {
    cookies::run_smoke();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn download_ids_are_unique_across_independent_batches() {
        // A restarted process has no shared sequence state with the previous launch.
        let previous_launch: HashSet<String> = (0..128).map(|_| new_download_id()).collect();
        let next_launch: HashSet<String> = (0..128).map(|_| new_download_id()).collect();
        assert_eq!(previous_launch.len(), 128);
        assert_eq!(next_launch.len(), 128);
        assert!(previous_launch.is_disjoint(&next_launch));
        for id in previous_launch.union(&next_launch) {
            let uuid = uuid::Uuid::parse_str(id.strip_prefix("download-").unwrap()).unwrap();
            assert_eq!(uuid.get_version(), Some(uuid::Version::Random));
        }
    }
    #[test]
    fn restricts_remote_urls() {
        for url in ["https://example.com/path", "http://localhost:1234"] {
            assert!(remote_url(url).is_ok());
        }
        for url in [
            "file:///C:/secret",
            "tauri://localhost",
            "javascript:alert(1)",
            "about:blank",
            "data:text/html,test",
            "https://",
        ] {
            assert!(remote_url(url).is_err(), "{url}");
        }
    }
    #[test]
    fn validates_ids_and_geometry() {
        assert!(valid_id("tab-hello-123"));
        for id in ["main", "tab-", "tab-../main", "tab-hello_world"] {
            assert!(!valid_id(id));
        }
        assert!(Bounds {
            x: 0.,
            y: 80.,
            width: 1280.,
            height: 740.
        }
        .validate()
        .is_ok());
        assert!(Bounds {
            x: f64::NAN,
            y: 0.,
            width: 1.,
            height: 1.
        }
        .validate()
        .is_err());
    }
    #[test]
    fn sanitizes_windows_download_names() {
        assert_eq!(safe_filename("../CON.txt"), "_CON.txt");
        assert_eq!(safe_filename("NUL.exe"), "_NUL.exe");
        assert_eq!(safe_filename("report:2026?.pdf "), "report_2026_.pdf");
        assert_eq!(safe_filename("..."), "download");
    }
    #[test]
    fn reserves_concurrent_download_names() {
        let dir = std::env::temp_dir().join(format!("mxplorer-test-{}", std::process::id()));
        let mut reserved = HashMap::new();
        let first = unique_destination(&dir, "report.pdf", &reserved);
        reserved.insert(
            first.clone(),
            Download {
                id: "1".into(),
                url: "".into(),
                name: "".into(),
                path: "".into(),
                status: "".into(),
            },
        );
        assert_eq!(
            unique_destination(&dir, "report.pdf", &reserved),
            dir.join("report (1).pdf")
        );
    }
}

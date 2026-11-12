//! Windows-only integration: genuine WebView2 history and keyboard accelerators.
use super::*;
use webview2_com::{
    AcceleratorKeyPressedEventHandler, ClearBrowsingDataCompletedHandler, CoTaskMemPWSTR,
    FindStartCompletedHandler, HistoryChangedEventHandler, Microsoft::Web::WebView2::Win32::*,
    NavigationCompletedEventHandler, NavigationStartingEventHandler, SourceChangedEventHandler,
};
use windows::{
    core::{Interface, BOOL, PCWSTR, PWSTR},
    Win32::UI::Input::KeyboardAndMouse::GetKeyState,
};

unsafe fn send_state(core: &ICoreWebView2, app: &tauri::AppHandle, id: &str) {
    let mut back = BOOL(0);
    let mut forward = BOOL(0);
    let mut source = PWSTR::null();
    let _ = core.CanGoBack(&mut back);
    let _ = core.CanGoForward(&mut forward);
    let url = if core.Source(&mut source).is_ok() {
        CoTaskMemPWSTR::from(source).to_string()
    } else {
        String::new()
    };
    // Do not expose blocked application protocols through the browser state.
    let mut payload = json!({"id":id,"canGoBack":back.as_bool(),"canGoForward":forward.as_bool()});
    if remote_url(&url).is_ok() {
        payload["url"] = Value::String(url);
    }
    emit(app, "tab-update", payload);
}
pub fn refresh(view: &Webview, app: &tauri::AppHandle, id: &str) {
    let app = app.clone();
    let id = id.to_owned();
    let _ = view.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            send_state(&core, &app, &id);
        }
    });
}

fn navigation_result(id: &str, success: bool, status: COREWEBVIEW2_WEB_ERROR_STATUS) -> Value {
    let error = if success || status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
        None
    } else {
        Some(match status {
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => "The website address could not be found. Check the address and your connection.".into(),
            COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => "The website took too long to respond. Try reloading the page.".into(),
            COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => "You appear to be offline. Check your internet connection and try again.".into(),
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET => "The connection to this website was interrupted. Try reloading the page.".into(),
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED => "A secure connection could not be established because the website's certificate is not valid.".into(),
            _ => format!("The website could not be loaded (network error {}). Try reloading the page.", status.0),
        })
    };
    json!({"id":id,"loading":false,"error":error})
}

fn shortcut(key: u32, ctrl: bool, shift: bool, alt: bool) -> Option<&'static str> {
    if key == 0x1B && !ctrl && !alt {
        return Some("stop");
    }
    if key == 0x7A {
        return Some("fullscreen");
    } // F11
    if key == 0x74 {
        return Some(if ctrl || shift {
            "hard-reload"
        } else {
            "reload"
        });
    }
    if alt && key == 0x44 {
        return Some("focus-address");
    }
    if alt && !ctrl {
        return match key {
            0x25 => Some("back"),
            0x27 => Some("forward"),
            _ => None,
        };
    }
    if !ctrl || alt {
        return None;
    }
    match (key, shift) {
        (0x54, true) => Some("restore-tab"),
        (0x54, false) => Some("new-tab"),
        (0x57, _) => Some("close-tab"),
        (0x4C, _) | (0x4B, _) => Some("focus-address"),
        (0x52, true) => Some("hard-reload"),
        (0x52, false) => Some("reload"),
        (0x48, _) => Some("history"),
        (0x4A, _) => Some("downloads"),
        (0x42, true) => Some("toggle-bookmarks-bar"),
        (0x4F, true) => Some("bookmarks"),
        (0x41, true) => Some("search-tabs"),
        (0x50, _) => Some("print"),
        (0x31, false) => Some("select-tab-1"),
        (0x32, false) => Some("select-tab-2"),
        (0x33, false) => Some("select-tab-3"),
        (0x34, false) => Some("select-tab-4"),
        (0x35, false) => Some("select-tab-5"),
        (0x36, false) => Some("select-tab-6"),
        (0x37, false) => Some("select-tab-7"),
        (0x38, false) => Some("select-tab-8"),
        (0x39, false) => Some("select-tab-9"),
        (0x44, _) => Some("bookmark-page"),
        (0x46, _) => Some("find"),
        (0x09, true) | (0x21, _) => Some("previous-tab"),
        (0x09, false) | (0x22, _) => Some("next-tab"),
        (0xBB, _) | (0x6B, _) => Some("zoom-in"),
        (0xBD, _) | (0x6D, _) => Some("zoom-out"),
        (0x30, _) | (0x60, _) => Some("zoom-reset"),
        _ => None,
    }
}

pub fn install(view: &Webview, app: &tauri::AppHandle, id: &str) -> Result {
    let app = app.clone();
    let id = id.to_owned();
    view.with_webview(move |platform| unsafe {
        let controller = platform.controller();
        let Ok(core) = controller.CoreWebView2() else {
            return;
        };
        let history_app = app.clone();
        let history_id = id.clone();
        let mut token = 0;
        let navigation = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let started_navigation = navigation.clone();
        let started_app = app.clone();
        let started_id = id.clone();
        let _ = core.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut navigation_id = 0;
                    args.NavigationId(&mut navigation_id)?;
                    started_navigation.store(navigation_id, std::sync::atomic::Ordering::Relaxed);
                    emit(
                        &started_app,
                        "tab-update",
                        json!({"id":started_id,"loading":true,"error":null}),
                    );
                }
                Ok(())
            })),
            &mut token,
        );
        let completed_app = app.clone();
        let completed_id = id.clone();
        let _ = core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                if let Some(args) = args {
                    let mut navigation_id = 0;
                    args.NavigationId(&mut navigation_id)?;
                    if navigation_id != navigation.load(std::sync::atomic::Ordering::Relaxed) {
                        return Ok(());
                    }
                    let mut success = BOOL(0);
                    args.IsSuccess(&mut success)?;
                    let mut status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                    args.WebErrorStatus(&mut status)?;
                    emit(
                        &completed_app,
                        "tab-update",
                        navigation_result(&completed_id, success.as_bool(), status),
                    );
                    if let Some(core) = sender {
                        send_state(&core, &completed_app, &completed_id);
                    }
                }
                Ok(())
            })),
            &mut token,
        );
        let _ = core.add_HistoryChanged(
            &HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    send_state(&core, &history_app, &history_id);
                }
                Ok(())
            })),
            &mut token,
        );
        let source_app = app.clone();
        let source_id = id.clone();
        let _ = core.add_SourceChanged(
            &SourceChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    send_state(&core, &source_app, &source_id);
                }
                Ok(())
            })),
            &mut token,
        );
        let shortcut_app = app.clone();
        let _ = controller.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                {
                    return Ok(());
                }
                let mut key = 0;
                args.VirtualKey(&mut key)?;
                let ctrl = GetKeyState(0x11) < 0;
                let shift = GetKeyState(0x10) < 0;
                let alt = GetKeyState(0x12) < 0;
                if let Some(action) = shortcut(key, ctrl, shift, alt) {
                    // Leave Escape available to WebView2's native find dialog as well.
                    if action != "stop" {
                        args.SetHandled(true)?;
                    }
                    if matches!(
                        action,
                        "focus-address"
                            | "new-tab"
                            | "history"
                            | "downloads"
                            | "bookmarks"
                            | "bookmark-page"
                            | "search-tabs"
                    ) {
                        // DOM focus alone cannot transfer input between native child views.
                        if let Some(main) = shortcut_app.get_webview("main") {
                            let _ = main.set_focus();
                        }
                    }
                    emit(&shortcut_app, "browser-shortcut", json!({"action":action}));
                }
                Ok(())
            })),
            &mut token,
        );
        send_state(&core, &app, &id);
    })
    .map_err(|e| e.to_string())
}

pub fn action(view: &Webview, action: String, value: Option<Value>) -> Result {
    if action == "zoom" {
        let scale = value
            .as_ref()
            .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
            .ok_or("Zoom requires a numeric scale")?;
        if !scale.is_finite() || !(0.25..=5.0).contains(&scale) {
            return Err("Zoom must be between 0.25 and 5".into());
        }
        return view.set_zoom(scale).map_err(|e| e.to_string());
    }
    let term = value.and_then(|v| v.as_str().map(str::to_owned));
    let fallback = view.clone();
    view.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else { return; };
        let result = match action.as_str() {
            "hard-reload" => core.CallDevToolsProtocolMethod(windows::core::w!("Page.reload"), windows::core::w!("{\"ignoreCache\":true}"), &webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())))),
            "back" => core.GoBack(), "forward" => core.GoForward(), "stop" => core.Stop(),
            "find" => {
                let supplied = term.is_some();
                let term = term.unwrap_or_default();
                // Current Evergreen WebView2 supports native highlighting. Older runtimes use window.find.
                let native_find = (|| -> windows::core::Result<()> {
                    let find = core.cast::<ICoreWebView2_28>()?.Find()?;
                    if supplied && term.is_empty() { return find.Stop(); }
                    let options = platform.environment().cast::<ICoreWebView2Environment15>()?.CreateFindOptions()?;
                    let wide: Vec<u16> = term.encode_utf16().chain(Some(0)).collect();
                    options.SetFindTerm(PCWSTR(wide.as_ptr()))?;
                    options.SetShouldHighlightAllMatches(true)?;
                    options.SetSuppressDefaultFindDialog(false)?;
                    find.Start(&options, &FindStartCompletedHandler::create(Box::new(|_| Ok(()))))
                })();
                if native_find.is_err() {
                    let text = serde_json::to_string(&term).unwrap_or_else(|_| "\"\"".into());
                    let script = if supplied { format!("window.find({text}, false, false, true)") } else { "(()=>{const term=prompt('Find in page'); if(term)window.find(term,false,false,true)})()".into() };
                    let _ = fallback.eval(&script);
                }
                Ok(())
            }
            _ => Ok(()),
        };
        if let Err(error) = result { eprintln!("WebView2 {action} failed: {error}"); }
    }).map_err(|e| e.to_string())
}

pub async fn clear_data(view: &Webview) -> Result {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    view.with_webview(move |platform| unsafe {
        let completion = sender.clone();
        let result = (|| -> windows::core::Result<()> {
            platform
                .controller()
                .CoreWebView2()?
                .cast::<ICoreWebView2_13>()?
                .Profile()?
                .cast::<ICoreWebView2Profile2>()?
                .ClearBrowsingDataAll(&ClearBrowsingDataCompletedHandler::create(Box::new(
                    move |status| {
                        let _ = completion.send(status.map_err(|e| e.to_string()));
                        Ok(())
                    },
                )))
        })();
        if let Err(error) = result {
            let _ = sender.send(Err(error.to_string()));
        }
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(std::time::Duration::from_secs(30))
            .map_err(|e| e.to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

pub async fn capture_preview(view: &Webview) -> Option<String> {
    use base64::Engine;
    use windows::Win32::System::Com::{
        StructuredStorage::CreateStreamOnHGlobal, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
    };
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    view.with_webview(move |platform| unsafe {
        let completion = sender.clone();
        let result = (|| -> windows::core::Result<()> {
            let stream = CreateStreamOnHGlobal(Default::default(), true)?;
            let captured = stream.clone();
            platform.controller().CoreWebView2()?.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &webview2_com::CapturePreviewCompletedHandler::create(Box::new(move |status| {
                    let bytes = (|| -> windows::core::Result<Vec<u8>> {
                        status?;
                        let mut stat = STATSTG::default();
                        captured.Stat(&mut stat, STATFLAG_NONAME)?;
                        // Bound transient allocations when unusually large windows are captured.
                        if stat.cbSize == 0 || stat.cbSize > 32 * 1024 * 1024 {
                            return Ok(Vec::new());
                        }
                        let mut bytes = vec![0; stat.cbSize as usize];
                        captured.Seek(0, STREAM_SEEK_SET, None)?;
                        let mut read = 0;
                        captured
                            .Read(
                                bytes.as_mut_ptr().cast(),
                                bytes.len() as u32,
                                Some(&mut read),
                            )
                            .ok()?;
                        bytes.truncate(read as usize);
                        Ok(bytes)
                    })()
                    .ok()
                    .filter(|bytes| !bytes.is_empty());
                    let _ = completion.send(bytes);
                    Ok(())
                })),
            )
        })();
        if result.is_err() {
            let _ = sender.send(None);
        }
    })
    .ok()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(std::time::Duration::from_secs(3))
            .ok()
            .flatten()
    })
    .await
    .ok()??;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accelerator_mapping() {
        assert_eq!(shortcut(0x54, true, false, false), Some("new-tab"));
        assert_eq!(shortcut(0x54, true, true, false), Some("restore-tab"));
        assert_eq!(shortcut(0x09, true, true, false), Some("previous-tab"));
        assert_eq!(shortcut(0x7A, false, false, false), Some("fullscreen"));
        assert_eq!(shortcut(0x54, false, false, false), None);
        assert_eq!(shortcut(0x25, false, false, true), Some("back"));
        assert_eq!(shortcut(0x27, false, false, true), Some("forward"));
        assert_eq!(shortcut(0x50, true, false, false), Some("print"));
        assert_eq!(shortcut(0x4B, true, false, false), Some("focus-address"));
        assert_eq!(
            shortcut(0x42, true, true, false),
            Some("toggle-bookmarks-bar")
        );
        assert_eq!(shortcut(0x4F, true, true, false), Some("bookmarks"));
        assert_eq!(shortcut(0x41, true, true, false), Some("search-tabs"));
        assert_eq!(shortcut(0x39, true, false, false), Some("select-tab-9"));
        assert_eq!(shortcut(0x1B, false, false, false), Some("stop"));
    }
    #[test]
    fn navigation_failures_finish_loading_and_success_clears_error() {
        let failure = navigation_result(
            "tab-a",
            false,
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
        );
        assert_eq!(failure["loading"], false);
        assert!(failure["error"]
            .as_str()
            .unwrap()
            .contains("address could not be found"));
        assert!(
            navigation_result("tab-a", true, COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN)["error"]
                .is_null()
        );
        assert!(navigation_result(
            "tab-a",
            false,
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED
        )["error"]
            .is_null());
    }
}

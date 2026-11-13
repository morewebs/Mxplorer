//! Cookie validation, encrypted templates and serialized profile maintenance.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CookieRecord {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub host_only: bool,
    pub same_site: SameSite,
    pub session: bool,
    pub expiration_date: Option<f64>,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SameSite {
    Unspecified,
    NoRestriction,
    Lax,
    Strict,
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct CookieKey {
    pub name: String,
    pub domain: String,
    pub path: String,
    pub host_only: bool,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SaveMode {
    None,
    Missing,
    Exact,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RestoreMode {
    Missing,
    Exact,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCookie {
    pub cookie: CookieRecord,
    pub mode: RestoreMode,
    pub enabled: bool,
    pub saved_at: f64,
    pub renewal_seconds: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieSnapshot {
    cookies: Vec<CookieRecord>,
    saved: Vec<SavedCookie>,
    last_restored_at: Option<f64>,
    restored_count: usize,
    error: Option<String>,
}
#[derive(Default)]
pub struct CookieState(pub tokio::sync::Mutex<Store>);
#[derive(Default)]
pub struct Store {
    loaded: bool,
    saved: Vec<SavedCookie>,
    last_restored_at: Option<f64>,
    restored_count: usize,
    error: Option<String>,
}
fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
impl CookieRecord {
    pub(super) fn key(&self) -> CookieKey {
        CookieKey {
            name: self.name.clone(),
            domain: self.domain.trim_start_matches('.').to_ascii_lowercase(),
            path: self.path.clone(),
            host_only: self.host_only,
        }
    }
}

fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    // Deliberately outside GuestProfile: ClearBrowsingDataAll must retain these copies.
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Application storage unavailable")?
        .join("saved-cookies.dpapi"))
}
fn read_vault(path: &Path) -> Result<Vec<SavedCookie>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    if std::fs::metadata(path)
        .map_err(|_| "Could not inspect saved cookie vault")?
        .len()
        > 16 * 1024 * 1024
    {
        return Err("Saved cookie vault exceeds its size limit".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "Could not read saved cookie vault")?;
    let mut plain = protect(&bytes, true)?;
    let parsed = serde_json::from_slice::<Vec<SavedCookie>>(&plain)
        .map_err(|_| "Saved cookie vault is damaged".to_string());
    plain.fill(0);
    let saved = parsed?;
    if saved.len() > 10_000 {
        return Err("Too many saved cookies".into());
    }
    let mut keys = HashSet::new();
    for item in &saved {
        validate_cookie(&item.cookie)?;
        let host = normalized_domain(&item.cookie.domain)?;
        scope(&format!("https://{host}"), &host, item.cookie.host_only)?;
        if !item.saved_at.is_finite()
            || item.saved_at < 0.
            || !item.renewal_seconds.is_finite()
            || !(1.0..=253_402_300_799.).contains(&item.renewal_seconds)
            || !keys.insert(item.cookie.key())
        {
            return Err("Saved cookie vault contains invalid records".into());
        }
    }
    Ok(saved)
}
fn write_vault(path: &Path, saved: &[SavedCookie]) -> Result {
    let mut plain = serde_json::to_vec(saved).map_err(|_| "Could not encode saved cookie vault")?;
    let encrypted = protect(&plain, false);
    plain.fill(0);
    let encrypted = encrypted?;
    std::fs::create_dir_all(path.parent().ok_or("Invalid vault location")?)
        .map_err(|_| "Could not create saved cookie storage")?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&encrypted)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|_| "Could not securely save cookie templates".into())
}
impl Store {
    fn load(&mut self, app: &tauri::AppHandle) -> Result {
        if self.loaded {
            return Ok(());
        }
        match read_vault(&vault_path(app)?) {
            Ok(saved) => {
                self.saved = saved;
                self.loaded = true;
                self.error = None;
                Ok(())
            }
            Err(error) => {
                self.error = Some(error.clone());
                Err(error)
            }
        }
    }
    fn replace(&mut self, app: &tauri::AppHandle, saved: Vec<SavedCookie>) -> Result {
        write_vault(&vault_path(app)?, &saved)?;
        self.saved = saved;
        Ok(())
    }
}
pub fn maintenance(app: &tauri::AppHandle) -> Result<Webview> {
    app.get_webview("profile-maintenance")
        .ok_or_else(|| "Cookie maintenance profile unavailable".into())
}
pub fn initialize(app: &tauri::AppHandle) -> Result {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Application storage unavailable")?
        .join("GuestProfile");
    std::fs::create_dir_all(&data).map_err(|_| "Could not create website profile")?;
    let builder = WebviewBuilder::new(
        "profile-maintenance",
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .data_directory(data)
    .focused(false)
    .devtools(false)
    .on_navigation(|url| url.as_str() == "about:blank")
    .on_new_window(|_, _| NewWindowResponse::Deny);
    let view = app
        .get_window("main")
        .ok_or("Main window unavailable")?
        .add_child(
            builder,
            tauri::LogicalPosition::new(-32000., -32000.),
            tauri::LogicalSize::new(1., 1.),
        )
        .map_err(|_| "Could not create cookie maintenance profile")?;
    view.hide()
        .map_err(|_| "Could not hide cookie maintenance profile")?;
    start_reconciler(app);
    Ok(())
}
fn start_reconciler(app: &tauri::AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = reconcile_profile(&app).await;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    })
}
async fn reconcile_locked(app: &tauri::AppHandle, store: &mut Store) -> Result {
    store.load(app)?;
    if !store.saved.iter().any(|s| s.enabled) {
        store.error = None;
        return Ok(());
    }
    let view = maintenance(app)?;
    let live = super::cookies_native::list(&view).await?;
    let planned = planned_restores(&store.saved, &live, now());
    if !planned.is_empty() {
        super::cookies_native::apply(&view, planned.clone()).await?;
        // Record renewed deadlines so exact mode remains stable on the following tick.
        let mut saved = store.saved.clone();
        for cookie in &planned {
            if let Some(item) = saved.iter_mut().find(|s| s.cookie.key() == cookie.key()) {
                item.cookie.expiration_date = cookie.expiration_date;
            }
        }
        store.replace(app, saved)?;
        store.last_restored_at = Some(now());
        store.restored_count = planned.len();
    }
    store.error = None;
    Ok(())
}
pub async fn reconcile_profile(app: &tauri::AppHandle) -> Result {
    let state = app.state::<CookieState>();
    let mut store = state.0.lock().await;
    let result = reconcile_locked(app, &mut store).await;
    if let Err(error) = &result {
        store.error = Some(error.clone());
    }
    result
}
pub async fn clear_profile(app: &tauri::AppHandle) -> Result {
    let state = app.state::<CookieState>();
    let mut store = state.0.lock().await;
    let loaded = store.load(app);
    native::clear_data(&maintenance(app)?).await?;
    // Clearing live data remains available even if the encrypted vault cannot be unlocked.
    // Keep the damaged vault and its visible error, and do not replace it with an empty file.
    if loaded.is_err() {
        return Ok(());
    }
    let result = reconcile_locked(app, &mut store).await;
    if let Err(error) = &result {
        store.error = Some(error.clone());
    }
    result
}
async fn snapshot(
    app: &tauri::AppHandle,
    store: &Store,
    url: Option<&str>,
) -> Result<CookieSnapshot> {
    if let Some(url) = url {
        remote_url(url)?;
    }
    let cookies = if let Some(url) = url {
        super::cookies_native::list(&maintenance(app)?)
            .await?
            .into_iter()
            .filter(|c| scope(url, &c.domain, c.host_only).is_ok())
            .collect()
    } else {
        Vec::new()
    };
    let saved = store
        .saved
        .iter()
        .filter(|s| url.is_none_or(|url| scope(url, &s.cookie.domain, s.cookie.host_only).is_ok()))
        .cloned()
        .collect();
    Ok(CookieSnapshot {
        cookies,
        saved,
        last_restored_at: store.last_restored_at,
        restored_count: store.restored_count,
        error: store.error.clone(),
    })
}
fn validate_key(url: Option<&str>, key: CookieKey) -> Result<CookieKey> {
    let domain = normalized_domain(&key.domain)?;
    if let Some(url) = url {
        scope(url, &domain, key.host_only)?;
    }
    if key.name.is_empty()
        || !key.path.starts_with('/')
        || key.path.chars().any(char::is_control)
        || key.name.chars().any(char::is_control)
    {
        return Err("Invalid cookie identity".into());
    }
    Ok(CookieKey { domain, ..key })
}

#[tauri::command]
pub async fn get_cookies(
    caller: Webview,
    app: tauri::AppHandle,
    url: Option<String>,
) -> Result<CookieSnapshot> {
    trusted(&caller)?;
    let state = app.state::<CookieState>();
    let mut store = state.0.lock().await;
    let _ = store.load(&app); // Return live cookies and a visible vault error when encrypted storage is damaged.
    snapshot(&app, &store, url.as_deref()).await
}
#[tauri::command]
pub async fn save_cookies(
    caller: Webview,
    app: tauri::AppHandle,
    url: String,
    cookies: Vec<CookieRecord>,
    mode: SaveMode,
    original: Option<CookieKey>,
) -> Result<CookieSnapshot> {
    trusted(&caller)?;
    let cookies = validate_batch(&url, cookies)?;
    let original = original
        .map(|key| validate_key(Some(&url), key))
        .transpose()?;
    if original.is_some() && cookies.len() != 1 {
        return Err("Editing an identity requires exactly one cookie".into());
    }
    let state = app.state::<CookieState>();
    let mut store = state.0.lock().await;
    store.load(&app)?;
    let at = now();
    let mut saved = store.saved.clone();
    if let Some(original) = &original {
        saved.retain(|s| s.cookie.key() != *original);
    }
    for cookie in &cookies {
        saved.retain(|s| s.cookie.key() != cookie.key());
        if mode != SaveMode::None {
            saved.push(SavedCookie {
                cookie: cookie.clone(),
                mode: if mode == SaveMode::Exact {
                    RestoreMode::Exact
                } else {
                    RestoreMode::Missing
                },
                enabled: true,
                saved_at: at,
                renewal_seconds: cookie
                    .expiration_date
                    .map(|date| date - at)
                    .filter(|duration| *duration > 0.)
                    .unwrap_or(30. * 86400.),
            });
        }
    }
    if saved.len() > 10_000 {
        return Err("Too many saved cookies".into());
    }
    // Commit removal/policy changes under the same gate used by ticks before touching live keys.
    store.replace(&app, saved)?;
    let view = maintenance(&app)?;
    if let Some(original) = original.filter(|key| cookies[0].key() != *key) {
        super::cookies_native::delete(&view, vec![original]).await?;
    }
    super::cookies_native::apply(&view, cookies).await?;
    reconcile_locked(&app, &mut store).await?;
    snapshot(&app, &store, Some(&url)).await
}
#[tauri::command]
pub async fn delete_cookies(
    caller: Webview,
    app: tauri::AppHandle,
    url: String,
    keys: Vec<CookieKey>,
    forget_saved: bool,
) -> Result<CookieSnapshot> {
    trusted(&caller)?;
    remote_url(&url)?;
    if keys.len() > 1000 {
        return Err("Too many cookies selected".into());
    }
    let keys = keys
        .into_iter()
        .map(|key| validate_key(Some(&url), key))
        .collect::<Result<Vec<_>>>()?;
    let state = app.state::<CookieState>();
    let mut store = state.0.lock().await;
    store.load(&app)?;
    if forget_saved {
        let saved = store
            .saved
            .iter()
            .filter(|s| !keys.contains(&s.cookie.key()))
            .cloned()
            .collect();
        store.replace(&app, saved)?;
    }
    super::cookies_native::delete(&maintenance(&app)?, keys).await?;
    snapshot(&app, &store, Some(&url)).await
}
#[tauri::command]
pub async fn set_saved_cookie(
    caller: Webview,
    app: tauri::AppHandle,
    key: CookieKey,
    enabled: Option<bool>,
    mode: Option<RestoreMode>,
    remove: Option<bool>,
    url: Option<String>,
) -> Result<CookieSnapshot> {
    trusted(&caller)?;
    let key = validate_key(url.as_deref(), key)?;
    let state = app.state::<CookieState>();
    let mut store = state.0.lock().await;
    store.load(&app)?;
    let mut saved = store.saved.clone();
    if remove.unwrap_or(false) {
        saved.retain(|s| s.cookie.key() != key);
    } else {
        let item = saved
            .iter_mut()
            .find(|s| s.cookie.key() == key)
            .ok_or("Saved cookie no longer exists")?;
        if let Some(enabled) = enabled {
            item.enabled = enabled;
        }
        if let Some(mode) = mode {
            item.mode = mode;
        }
    }
    store.replace(&app, saved)?;
    snapshot(&app, &store, url.as_deref()).await
}
#[tauri::command]
pub async fn restore_cookies(
    caller: Webview,
    app: tauri::AppHandle,
    url: Option<String>,
) -> Result<CookieSnapshot> {
    trusted(&caller)?;
    if let Some(url) = &url {
        remote_url(url)?;
    }
    let state = app.state::<CookieState>();
    let mut store = state.0.lock().await;
    if let Err(error) = reconcile_locked(&app, &mut store).await {
        store.error = Some(error);
    }
    snapshot(&app, &store, url.as_deref()).await
}

fn validate_batch(url: &str, mut cookies: Vec<CookieRecord>) -> Result<Vec<CookieRecord>> {
    if cookies.is_empty() || cookies.len() > 500 {
        return Err("Import must contain between 1 and 500 cookies".into());
    }
    let mut keys = HashSet::new();
    for cookie in &mut cookies {
        validate_cookie(cookie)?;
        scope(url, &cookie.domain, cookie.host_only)?;
        let domain = normalized_domain(&cookie.domain)?;
        cookie.domain = if cookie.host_only {
            domain
        } else {
            format!(".{domain}")
        };
        if cookie.session {
            cookie.expiration_date = None;
        } else if let Some(deadline) = &mut cookie.expiration_date {
            // Chromium limits persistent cookies to 400 days. Normalize before saving so
            // exact mode does not continually fight a deadline clamped by the native store.
            *deadline = deadline.min(now() + 400. * 86400.);
        }
        if !keys.insert(cookie.key()) {
            return Err("Duplicate cookie identity in import".into());
        }
    }
    Ok(cookies)
}
fn validate_cookie(cookie: &CookieRecord) -> Result {
    if cookie.name.is_empty()
        || !cookie
            .name
            .bytes()
            .all(|b| b.is_ascii_graphic() && !b"()<>@,;:\\\"/[]?={}".contains(&b))
    {
        return Err("Invalid cookie name".into());
    }
    if !cookie.value.bytes().all(|b| {
        b == 0x21
            || (0x23..=0x2b).contains(&b)
            || (0x2d..=0x3a).contains(&b)
            || (0x3c..=0x5b).contains(&b)
            || (0x5d..=0x7e).contains(&b)
    }) {
        return Err(
            "Cookie values must use cookie-safe ASCII characters; encode other characters first"
                .into(),
        );
    }
    normalized_domain(&cookie.domain)?;
    if !cookie.path.starts_with('/')
        || cookie.path.chars().any(char::is_control)
        || cookie.path.contains(';')
    {
        return Err("Invalid cookie path".into());
    }
    if cookie.name.len() + cookie.value.len() > 4096
        || cookie.domain.len() > 253
        || cookie.path.len() > 1024
    {
        return Err("Cookie exceeds the 4096-byte limit".into());
    }
    if cookie
        .expiration_date
        .is_some_and(|v| !v.is_finite() || !(0.0..=253_402_300_799.).contains(&v))
        || !cookie.session && cookie.expiration_date.is_none()
    {
        return Err("Invalid cookie expiration".into());
    }
    if cookie.same_site == SameSite::NoRestriction && !cookie.secure {
        return Err("SameSite=None requires Secure".into());
    }
    if cookie.name.starts_with("__Secure-") && !cookie.secure {
        return Err("__Secure- cookies require Secure".into());
    }
    if cookie.name.starts_with("__Host-")
        && (!cookie.secure || !cookie.host_only || cookie.path != "/")
    {
        return Err("__Host- cookies require Secure, host-only scope and path /".into());
    }
    Ok(())
}
fn planned_restores(saved: &[SavedCookie], live: &[CookieRecord], at: f64) -> Vec<CookieRecord> {
    saved
        .iter()
        .filter(|s| s.enabled)
        .filter_map(|saved| {
            let existing = live.iter().find(|c| c.key() == saved.cookie.key());
            if existing.is_some() && saved.mode == RestoreMode::Missing {
                return None;
            }
            if existing.is_some_and(|c| equivalent(c, &saved.cookie)) {
                return None;
            }
            let mut cookie = saved.cookie.clone();
            if !cookie.session && cookie.expiration_date.is_none_or(|date| date <= at) {
                cookie.expiration_date =
                    Some((at + saved.renewal_seconds.min(400. * 86400.)).min(253_402_300_799.));
            }
            Some(cookie)
        })
        .collect()
}
fn equivalent(left: &CookieRecord, right: &CookieRecord) -> bool {
    let mut left = left.clone();
    let mut right = right.clone();
    left.domain = left.domain.trim_start_matches('.').to_ascii_lowercase();
    right.domain = right.domain.trim_start_matches('.').to_ascii_lowercase();
    if left.same_site == SameSite::Unspecified {
        left.same_site = SameSite::Lax;
    }
    if right.same_site == SameSite::Unspecified {
        right.same_site = SameSite::Lax;
    }
    match (left.expiration_date, right.expiration_date) {
        (Some(a), Some(b)) if (a - b).abs() < 1. => {
            left.expiration_date = right.expiration_date;
        }
        _ => {}
    }
    left == right
}
#[cfg(windows)]
fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{LocalFree, HLOCAL},
            Security::Cryptography::*,
        },
    };
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Saved cookie vault exceeds its size limit".into());
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if decrypt {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| {
            "Windows could not unlock or protect the saved cookie vault".to_string()
        })?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        // DPAPI allocates with LocalAlloc; erase decrypted temporary memory before freeing it.
        if decrypt {
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        }
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}
#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>> {
    Err("Cookie vault requires Windows DPAPI".into())
}

#[cfg(any(test, feature = "native-cookie-smoke"))]
mod tests {
    use super::*;
    #[test]
    fn parent_domains_are_scoped_and_public_suffixes_rejected() {
        assert!(scope("https://www.example.co.uk", "example.co.uk", false).is_ok());
        assert!(scope("https://www.example.co.uk", "co.uk", false).is_err());
        assert!(scope("https://www.example.com", "example.com", true).is_err());
        assert!(scope("https://example.com", "other.com", false).is_err());
    }
    #[test]
    fn ipv6_host_only_scope_and_long_expiry_follow_chromium_limits() {
        assert!(scope("https://[::1]/", "[::1]", true).is_ok());
        assert!(scope("https://[::1]/", "[::1]", false).is_err());
        let mut long = cookie();
        long.expiration_date = Some(now() + 10_000. * 86400.);
        let validated = validate_batch("https://example.com", vec![long]).unwrap();
        assert!(validated[0].expiration_date.unwrap() <= now() + 400. * 86400.);
    }
    fn cookie() -> CookieRecord {
        CookieRecord {
            name: "synthetic".into(),
            value: "test-fixture".into(),
            domain: "example.com".into(),
            path: "/".into(),
            secure: true,
            http_only: true,
            host_only: true,
            same_site: SameSite::Lax,
            session: false,
            expiration_date: Some(10_000.),
        }
    }
    #[cfg(test)]
    fn saved(mode: RestoreMode) -> SavedCookie {
        SavedCookie {
            cookie: cookie(),
            mode,
            enabled: true,
            saved_at: 100.,
            renewal_seconds: 500.,
        }
    }
    #[test]
    fn validates_whole_batch_and_security_rules() {
        let good = cookie();
        let mut bad = good.clone();
        bad.domain = "evil.com".into();
        assert!(validate_batch("https://example.com", vec![good.clone(), bad]).is_err());
        for change in 0..8 {
            let mut bad = good.clone();
            match change {
                0 => bad.name = "bad;name".into(),
                1 => bad.value = "bad\nvalue".into(),
                2 => bad.expiration_date = Some(f64::NAN),
                3 => {
                    bad.same_site = SameSite::NoRestriction;
                    bad.secure = false;
                }
                4 => {
                    bad.name = "__Host-test".into();
                    bad.host_only = false;
                }
                5 => {
                    bad.name = "__Secure-test".into();
                    bad.secure = false;
                }
                6 => bad.path = "relative".into(),
                _ => bad.value = "x".repeat(4096),
            }
            assert!(
                validate_batch("https://example.com", vec![bad]).is_err(),
                "rule {change}"
            );
        }
        let mut other_path = good.clone();
        other_path.path = "/other".into();
        assert_eq!(
            validate_batch("https://example.com", vec![good, other_path])
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn missing_preserves_changes_exact_restores_and_pause_stops() {
        let mut changed = cookie();
        changed.value = "refreshed-fixture".into();
        assert!(
            planned_restores(&[saved(RestoreMode::Missing)], &[changed.clone()], 100.).is_empty()
        );
        assert_eq!(
            planned_restores(&[saved(RestoreMode::Exact)], &[changed], 100.).len(),
            1
        );
        let mut paused = saved(RestoreMode::Exact);
        paused.enabled = false;
        assert!(planned_restores(&[paused], &[], 100.).is_empty());
    }
    #[test]
    fn expired_templates_renew_and_cookie_identity_includes_scope_and_path() {
        let template = saved(RestoreMode::Exact);
        let restored = planned_restores(std::slice::from_ref(&template), &[], 20_000.);
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].expiration_date, Some(20_500.));
        let mut domain = cookie();
        domain.host_only = false;
        domain.domain = ".example.com".into();
        assert_eq!(planned_restores(&[template], &[domain], 100.).len(), 1);
    }
    #[cfg(windows)]
    #[test]
    fn windows_dpapi_encrypts_and_roundtrips() {
        let plain = b"synthetic-cookie-test-fixture";
        let encrypted = protect(plain, false).unwrap();
        assert_ne!(encrypted, plain);
        assert_eq!(protect(&encrypted, true).unwrap(), plain);
        let mut corrupted = encrypted;
        corrupted[0] ^= 0xff;
        assert!(protect(&corrupted, true).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn vault_replaces_encrypted_file_and_rejects_corruption() {
        let folder =
            std::env::temp_dir().join(format!("mxplorer-vault-test-{}", uuid::Uuid::new_v4()));
        let path = folder.join("saved-cookies.dpapi");
        write_vault(&path, &[saved(RestoreMode::Missing)]).unwrap();
        assert_eq!(read_vault(&path).unwrap().len(), 1);
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes
            .windows(b"test-fixture".len())
            .any(|part| part == b"test-fixture"));
        write_vault(&path, &[]).unwrap();
        assert!(read_vault(&path).unwrap().is_empty());
        std::fs::write(&path, b"corrupt-synthetic-data").unwrap();
        assert!(read_vault(&path).is_err());
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[cfg(all(windows, feature = "native-cookie-smoke"))]
    pub(super) fn native_cookie_profile_smoke() {
        let folder =
            std::env::temp_dir().join(format!("mxplorer-cookie-smoke-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let profile = folder.join("GuestProfile");
        let folder_for_setup = folder.clone();
        let (sender, receiver) = std::sync::mpsc::channel::<Result>();
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier =
            format!("com.moreweb.mxplorer.smoke.{}", uuid::Uuid::new_v4());
        let application =
            tauri::Builder::default()
                .any_thread()
                .manage(CookieState::default())
                .setup(move |app| {
                    let window = tauri::WindowBuilder::new(app, "main")
                        .title("Mxplorer isolated cookie test")
                        .visible(false)
                        .build()?;
                    for label in ["profile-maintenance", "smoke-shared-guest"] {
                        let view = window.add_child(
                            WebviewBuilder::new(
                                label,
                                WebviewUrl::External("about:blank".parse().unwrap()),
                            )
                            .data_directory(profile.clone())
                            .focused(false)
                            .devtools(false),
                            tauri::LogicalPosition::new(-32000., -32000.),
                            tauri::LogicalSize::new(1., 1.),
                        )?;
                        view.hide()?;
                    }
                    let handle = app.handle().clone();
                    let folder = folder_for_setup.clone();
                    tauri::async_runtime::spawn(async move {
                        let test_app = handle.clone();
                        let worker = tauri::async_runtime::spawn(async move {
                            smoke_worker(&test_app, &folder).await
                        });
                        let result =
                            match tokio::time::timeout(std::time::Duration::from_secs(90), worker)
                                .await
                            {
                                Ok(Ok(result)) => result,
                                Ok(Err(_)) => Err("Native smoke worker panicked".into()),
                                Err(_) => Err("Native smoke harness timed out".into()),
                            };
                        let _ = sender.send(result);
                        handle.exit(0);
                    });
                    Ok(())
                })
                .build(context)
                .unwrap();
        let isolated_storage = application.path().app_local_data_dir().unwrap();
        let code = application.run_return(|_, _| {});
        assert_eq!(code, 0);
        let result = receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("Native smoke harness returned no result");
        // WebView2 may release profile files asynchronously after the runtime exits.
        let _ = std::fs::remove_dir_all(&folder);
        let _ = std::fs::remove_file(isolated_storage.join("saved-cookies.dpapi"));
        let _ = std::fs::remove_dir(&isolated_storage);
        result.unwrap();
        println!("PASS: native cookie attributes, sharing, deletion, clearing, encryption, background policies, pause, and vault reload");
    }
    #[cfg(all(windows, feature = "native-cookie-smoke"))]
    async fn smoke_worker(app: &tauri::AppHandle, folder: &Path) -> Result {
        use super::super::cookies_native as native;
        macro_rules! check {
            ($condition:expr, $message:literal) => {
                if !$condition {
                    return Err($message.into());
                }
            };
        }
        let view = maintenance(app)?;
        let guest = app
            .get_webview("smoke-shared-guest")
            .ok_or("Missing shared test view")?;
        check!(
            native::list(&view).await?.is_empty(),
            "Isolated profile was not initially empty"
        );
        let mut host = cookie();
        host.expiration_date = Some(now().floor() + 3600.);
        let mut domain = host.clone();
        domain.host_only = false;
        domain.domain = ".example.com".into();
        domain.same_site = SameSite::Strict;
        let mut path = host.clone();
        path.path = "/nested".into();
        path.session = true;
        path.expiration_date = None;
        native::apply(&view, vec![host.clone(), domain.clone(), path.clone()]).await?;
        let all = native::list(&view).await?;
        check!(
            all.len() == 3,
            "Native store did not preserve host-only/domain/path identities"
        );
        for expected in [&host, &domain, &path] {
            check!(
                all.iter().any(|actual| equivalent(actual, expected)),
                "Native cookie attributes did not roundtrip"
            );
        }
        check!(
            native::list(&guest).await?.len() == 3,
            "Guest views did not share their cookie profile"
        );
        let template = SavedCookie {
            cookie: host.clone(),
            mode: RestoreMode::Exact,
            enabled: true,
            saved_at: now(),
            renewal_seconds: 3600.,
        };
        let mut changed = host.clone();
        changed.value = "refreshed-fixture".into();
        native::apply(&guest, vec![changed]).await?;
        let live = native::list(&view).await?;
        let mut missing = template.clone();
        missing.mode = RestoreMode::Missing;
        check!(
            planned_restores(&[missing], &live, now()).is_empty(),
            "Missing policy replaced refreshed website values"
        );
        let planned = planned_restores(std::slice::from_ref(&template), &live, now());
        check!(
            planned.len() == 1,
            "Exact policy did not detect a replaced value"
        );
        native::apply(&view, planned).await?;
        native::delete(&view, vec![host.key()]).await?;
        let live = native::list(&view).await?;
        check!(
            live.len() == 2 && live.iter().any(|c| c.key() == domain.key()),
            "Individual deletion removed another cookie identity"
        );
        let vault = folder.join("saved-cookies.dpapi");
        write_vault(&vault, std::slice::from_ref(&template))?;
        super::super::native::clear_data(&view).await?;
        check!(
            native::list(&guest).await?.is_empty(),
            "ClearBrowsingDataAll left live cookies behind"
        );
        check!(
            read_vault(&vault)?.len() == 1,
            "Clearing profile erased the saved vault"
        );
        let restored = planned_restores(&read_vault(&vault)?, &[], now());
        native::apply(&view, restored).await?;
        let live = native::list(&guest).await?;
        check!(
            live.len() == 1 && equivalent(&live[0], &host),
            "Saved cookie did not restore after clear"
        );

        // Exercise the actual production timer and Store, with no sidebar or trusted UI running.
        let production_vault = vault_path(app)?;
        let mut missing = template.clone();
        missing.mode = RestoreMode::Missing;
        write_vault(&production_vault, std::slice::from_ref(&missing))?;
        super::super::native::clear_data(&view).await?;
        let timer = start_reconciler(app);
        wait_for_value(&guest, &host.key(), Some(&host.value)).await?;

        let mut refreshed = host.clone();
        refreshed.value = "synthetic-rotated-value".into();
        native::apply(&guest, vec![refreshed.clone()]).await?;
        tokio::time::sleep(std::time::Duration::from_millis(2300)).await;
        check!(
            native::list(&guest)
                .await?
                .iter()
                .any(|c| equivalent(c, &refreshed)),
            "Background missing policy overwrote a site refresh"
        );
        {
            let state = app.state::<CookieState>();
            let mut store = state.0.lock().await;
            store.replace(app, vec![template.clone()])?;
        }
        wait_for_value(&guest, &host.key(), Some(&host.value)).await?;
        {
            let state = app.state::<CookieState>();
            let mut store = state.0.lock().await;
            let mut paused = template.clone();
            paused.enabled = false;
            store.replace(app, vec![paused])?;
            native::delete(&guest, vec![host.key()]).await?;
        }
        tokio::time::sleep(std::time::Duration::from_millis(2300)).await;
        check!(
            native::list(&guest).await?.is_empty(),
            "Paused background entry was restored"
        );
        {
            let state = app.state::<CookieState>();
            let mut store = state.0.lock().await;
            write_vault(&production_vault, std::slice::from_ref(&template))?;
            *store = Store::default();
        }
        wait_for_value(&guest, &host.key(), Some(&host.value)).await?;
        clear_profile(app).await?;
        check!(
            native::list(&guest)
                .await?
                .iter()
                .any(|c| equivalent(c, &host)),
            "Production clear did not restore enabled saved cookies"
        );
        timer.abort();
        {
            let state = app.state::<CookieState>();
            let mut store = state.0.lock().await;
            std::fs::write(&production_vault, b"synthetic-damaged-vault")
                .map_err(|_| "Could not prepare isolated corrupt-vault fixture")?;
            *store = Store::default();
        }
        clear_profile(app).await?;
        check!(
            native::list(&guest).await?.is_empty(),
            "Damaged vault blocked clearing the native profile"
        );
        check!(
            std::fs::read(&production_vault)
                .map_err(|_| "Could not inspect isolated corrupt vault")?
                == b"synthetic-damaged-vault",
            "Damaged vault was silently overwritten"
        );
        Ok(())
    }
    #[cfg(all(windows, feature = "native-cookie-smoke"))]
    async fn wait_for_value(view: &Webview, key: &CookieKey, value: Option<&str>) -> Result {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            let cookies = super::super::cookies_native::list(view).await?;
            let found = cookies.iter().find(|cookie| cookie.key() == *key);
            if match (found, value) {
                (Some(cookie), Some(value)) => cookie.value == value,
                (None, None) => true,
                _ => false,
            } {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(
                    "Production background cookie reconciliation did not reach the expected state"
                        .into(),
                );
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
}

#[cfg(all(windows, feature = "native-cookie-smoke"))]
pub fn run_smoke() {
    tests::native_cookie_profile_smoke();
}

fn scope(url: &str, domain: &str, host_only: bool) -> Result {
    let url = remote_url(url)?;
    let host = url.host_str().ok_or("Website has no host")?;
    let domain = normalized_domain(domain)?;
    if host_only {
        if host != domain {
            return Err("Host-only cookies must use the current website host".into());
        }
    } else {
        if matches!(
            url::Host::parse(&domain),
            Ok(url::Host::Ipv4(_) | url::Host::Ipv6(_))
        ) || !host.ends_with(&format!(".{domain}")) && host != domain
        {
            return Err("Cookie domain is outside the current website".into());
        }
        if psl::domain(domain.as_bytes()).is_none() {
            return Err("Domain cookies cannot use a public suffix".into());
        }
    }
    Ok(())
}

fn normalized_domain(raw: &str) -> Result<String> {
    let raw = raw.strip_prefix('.').unwrap_or(raw);
    if raw.is_empty()
        || raw.ends_with('.')
        || raw.contains(['/', '@', ' ', '\\'])
        || raw.chars().any(char::is_control)
    {
        return Err("Invalid cookie domain".into());
    }
    let host = url::Host::parse(raw).map_err(|_| "Invalid cookie domain")?;
    Ok(host.to_string().to_ascii_lowercase())
}
